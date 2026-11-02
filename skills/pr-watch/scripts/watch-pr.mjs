#!/usr/bin/env node
// watch-pr — wait on GitHub for changes to pull requests, at zero model cost.
//
// Why this exists: a session that opens a PR should stay with it until it
// merges, but polling from the model spends tokens while nothing happens. This
// script does the waiting. Run it in the background; it exits, printing one JSON
// object, as soon as something worth waking the session for has changed.
//
// It compares each poll against a saved snapshot, so changes that landed while
// the laptop slept are reported on the first poll. A PR with no saved snapshot
// gets its first poll as a baseline and reports nothing. The state file holds
// snapshots and modes only, never comment bodies. It never writes to GitHub.
//
// Usage:
//   node watch-pr.mjs --once <pr>... [--repo owner/name] [--state-file path]
//   node watch-pr.mjs <pr>... [--interval 180] [--max-wait seconds] [--repo owner/name] [--state-file path]
//   node watch-pr.mjs --set-mode <pr> <reviewers|no-reviewers> [--repo owner/name] [--state-file path]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const USAGE = `Usage:
  watch-pr.mjs --once <pr>... [--repo owner/name] [--state-file path]
  watch-pr.mjs <pr>... [--interval 180] [--max-wait seconds] [--repo owner/name] [--state-file path]
  watch-pr.mjs --set-mode <pr> <reviewers|no-reviewers> [--repo owner/name] [--state-file path]`;

const MODES = ['reviewers', 'no-reviewers'];
const KINDS = ['issue', 'line', 'review'];
const MAX_FAILURES = 5;
const FAILING = [
  'FAILURE',
  'TIMED_OUT',
  'CANCELLED',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
  'ERROR',
];
const VIEW_FIELDS =
  'number,url,state,isDraft,reviewDecision,mergeable,mergeStateStatus,autoMergeRequest,statusCheckRollup,comments,reviews,headRefOid';

// PR numbers are positional, so --once and --set-mode are plain flags that must
// not swallow the number after them.
export function parseArgs(argv) {
  const out = { once: false, setMode: false, prs: [] };
  const valued = ['interval', 'max-wait', 'repo', 'state-file'];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--once') out.once = true;
    else if (a === '--set-mode') out.setMode = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2);
      if (!valued.includes(key)) throw new Error(`Unknown flag ${a}.`);
      if (argv[i + 1] === undefined) throw new Error(`${a} needs a value.`);
      out[key] = argv[++i];
    } else out.positional = [...(out.positional ?? []), a];
  }
  const positional = out.positional ?? [];
  delete out.positional;

  if (out.setMode) {
    if (positional.length !== 2) throw new Error('--set-mode takes exactly <pr> <mode>.');
    if (!MODES.includes(positional[1])) throw new Error(`Mode must be one of ${MODES.join(', ')}.`);
    out.mode = positional[1];
    out.prs = [parsePr(positional[0])];
  } else {
    if (positional.length === 0) throw new Error('Provide at least one PR number.');
    out.prs = [...new Set(positional.map(parsePr))];
  }
  if (out.repo !== undefined && !/^[\w.-]+\/[\w.-]+$/.test(out.repo)) {
    throw new Error('--repo must look like owner/name.');
  }
  out.intervalMs = parseSeconds(out.interval ?? '180', '--interval') * 1000;
  out.maxWaitMs = out['max-wait'] ? parseSeconds(out['max-wait'], '--max-wait') * 1000 : 0;
  return out;
}

function parsePr(s) {
  if (!/^[1-9]\d*$/.test(s)) throw new Error(`"${s}" is not a positive PR number.`);
  return Number(s);
}

function parseSeconds(s, flag) {
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${flag} must be a positive number.`);
  return n;
}

export function summarizeChecks(rollup) {
  const items = rollup ?? [];
  if (items.length === 0) return { checks: 'none', failed: [] };
  const failed = [];
  let pending = false;
  for (const item of items) {
    const isContext = item.__typename === 'StatusContext' || 'context' in item;
    const outcome = isContext ? item.state : item.conclusion;
    if (FAILING.includes(outcome)) failed.push(isContext ? item.context : item.name);
    else if (
      isContext ? ['PENDING', 'EXPECTED'].includes(item.state) : item.status !== 'COMPLETED'
    ) {
      pending = true;
    }
  }
  if (failed.length) return { checks: 'failing', failed };
  return { checks: pending ? 'pending' : 'passing', failed: [] };
}

// GraphQL authors are `author.login`, REST authors are `user.login`. Logins are
// passed through as each API gives them. Comment bodies are deliberately dropped.
export function normalize(view, lineComments) {
  const item = (kind, id, author, association, state) => ({
    kind,
    id: String(id),
    author: author ?? '',
    association: association ?? '',
    state,
  });
  const items = [
    ...(view.comments ?? []).map((c) => item('issue', c.id, c.author?.login, c.authorAssociation)),
    ...lineComments.map((c) => item('line', c.id, c.user?.login, c.author_association)),
    ...(view.reviews ?? [])
      .filter((r) => r.state !== 'PENDING')
      .map((r) => item('review', r.id, r.author?.login, r.authorAssociation, r.state)),
  ];
  return {
    number: view.number,
    url: view.url,
    state: view.state,
    isDraft: view.isDraft,
    reviewDecision: view.reviewDecision || '',
    mergeable: view.mergeable,
    mergeStateStatus: view.mergeStateStatus,
    autoMerge: view.autoMergeRequest != null,
    headRefOid: view.headRefOid,
    ...summarizeChecks(view.statusCheckRollup),
    items,
  };
}

// GitHub computes mergeability lazily and answers UNKNOWN until it has.
const isUnknown = (v) => !v || v === 'UNKNOWN';

// Turns a normalized snapshot into what gets saved: the seen comment IDs
// instead of the items, and the previous mergeability if GitHub is still unsure.
export function toStored(prev, next) {
  const { items, ...rest } = next;
  for (const key of ['mergeable', 'mergeStateStatus']) {
    if (isUnknown(rest[key]) && prev?.[key]) rest[key] = prev[key];
  }
  const seen = {};
  for (const kind of KINDS) {
    const ids = items.filter((i) => i.kind === kind).map((i) => i.id);
    seen[kind] = [...new Set([...(prev?.seen?.[kind] ?? []), ...ids])];
  }
  return { ...rest, seen };
}

// prev is a stored snapshot (or undefined for a first poll), next a normalized one.
export function diffSnapshots(prev, next, selfLogin) {
  if (!prev) return [];
  const pr = next.number;
  const events = [];

  for (const i of next.items) {
    if (prev.seen?.[i.kind]?.includes(i.id) || i.author === selfLogin) continue;
    if (i.kind === 'review' && i.state !== 'COMMENTED') {
      events.push({ pr, type: 'review', id: i.id, author: i.author, state: i.state });
    } else {
      events.push({
        pr,
        type: 'comment',
        kind: i.kind,
        id: i.id,
        author: i.author,
        association: i.association,
      });
    }
  }

  // `pending` is not actionable, so it never wakes the session.
  if (next.checks !== prev.checks && next.checks !== 'pending') {
    events.push({ pr, type: 'checks', from: prev.checks, to: next.checks, failed: next.failed });
  }
  if (next.reviewDecision !== prev.reviewDecision) {
    events.push({
      pr,
      type: 'review_decision',
      from: prev.reviewDecision,
      to: next.reviewDecision,
    });
  }
  if (!isUnknown(next.mergeStateStatus) && next.mergeStateStatus !== prev.mergeStateStatus) {
    events.push({
      pr,
      type: 'merge_state',
      from: prev.mergeStateStatus,
      to: next.mergeStateStatus,
    });
  }
  if (next.isDraft !== prev.isDraft) events.push({ pr, type: 'draft', to: next.isDraft });
  if (next.autoMerge !== prev.autoMerge)
    events.push({ pr, type: 'auto_merge', to: next.autoMerge });
  if (next.state !== prev.state) events.push({ pr, type: 'state', to: next.state });
  return events;
}

export function publicView(entry) {
  const s = entry.snapshot;
  return {
    url: s.url,
    state: s.state,
    isDraft: s.isDraft,
    mode: entry.mode,
    checks: s.checks,
    failed: s.failed,
    reviewDecision: s.reviewDecision,
    mergeable: s.mergeable,
    mergeStateStatus: s.mergeStateStatus,
    autoMerge: s.autoMerge,
    headRefOid: s.headRefOid,
  };
}

export function allClosed(prs) {
  const states = Object.values(prs).map((p) => p.state);
  return states.length > 0 && states.every((s) => s === 'MERGED' || s === 'CLOSED');
}

export async function runLoop({ poll, sleep, now, intervalMs, maxWaitMs }) {
  const start = now();
  let failures = 0;
  let last = {};
  for (;;) {
    try {
      const result = await poll();
      failures = 0;
      last = result.prs;
      if (result.events.length > 0 || result.allClosed) return result;
    } catch (err) {
      if (++failures >= MAX_FAILURES) throw err;
    }
    if (maxWaitMs && now() - start >= maxWaitMs) {
      return { events: [{ type: 'timeout' }], prs: last, allClosed: false };
    }
    await sleep(intervalMs);
  }
}

// Throws with stderr on failure so the loop can count it.
function gh(args) {
  const res = spawnSync('gh', args, { encoding: 'utf8' });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`gh ${args[0]} failed: ${res.stderr.trim()}`);
  return res.stdout;
}

function loadState(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { prs: {} };
}

function saveState(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + '\n');
}

function resolveRepo(args) {
  return (
    args.repo ?? gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).trim()
  );
}

function statePathFor(args) {
  if (args['state-file']) return args['state-file'];
  return join(homedir(), '.claude', 'pr-watch', `${resolveRepo(args).replace('/', '__')}.json`);
}

function pollOnce({ repo, prs, statePath, selfLogin }) {
  const state = loadState(statePath);
  const events = [];
  const out = {};
  for (const n of prs) {
    const view = JSON.parse(gh(['pr', 'view', String(n), '--repo', repo, '--json', VIEW_FIELDS]));
    // --slurp wraps the pages in one array; plain --paginate emits [..][..], which is not JSON.
    const pages = JSON.parse(
      gh(['api', '--paginate', '--slurp', `repos/${repo}/pulls/${n}/comments`]),
    );
    const next = normalize(view, pages.flat());
    const entry = state.prs[n] ?? {};
    entry.mode ??= 'reviewers';
    events.push(...diffSnapshots(entry.snapshot, next, selfLogin));
    entry.snapshot = toStored(entry.snapshot, next);
    state.prs[n] = entry;
    out[n] = publicView(entry);
  }
  saveState(statePath, state);
  return { events, prs: out, allClosed: allClosed(out) };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`${err.message}\n\n${USAGE}`);
    process.exit(2);
  }

  try {
    const statePath = statePathFor(args);

    if (args.setMode) {
      const state = loadState(statePath);
      const n = args.prs[0];
      state.prs[n] = { ...state.prs[n], mode: args.mode };
      saveState(statePath, state);
      console.log(JSON.stringify({ pr: n, mode: args.mode }));
      return;
    }

    const repo = resolveRepo(args);
    const selfLogin = gh(['api', 'user', '--jq', '.login']).trim();
    const poll = async () => pollOnce({ repo, prs: args.prs, statePath, selfLogin });
    const result = args.once
      ? await poll()
      : await runLoop({
          poll,
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          now: Date.now,
          intervalMs: args.intervalMs,
          maxWaitMs: args.maxWaitMs,
        });
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
