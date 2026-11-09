#!/usr/bin/env node
// visual-qa — before/after QA of a PR's deploy preview, driven from the CLI.
//
// Why this exists: the session that watches a PR needs one tool that checks the
// setup, remembers which previews exist, keeps the approved-author list, and
// (in later subcommands) gates, signs in, and captures. Each command prints one
// JSON object. Exit codes: 0 done, 1 error, 2 bad usage or refused, 3 blocked,
// 4 Sean needs to finish sign-in. Secrets are never printed.

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  approveAuthor,
  loadConfig,
  rememberPreview,
  saveConfig,
  validateConfig,
} from './config.mjs';
import { findPreviews } from '../../pr-watch/scripts/watch-pr.mjs';
import { approvePr, findPreviewCheck, loadGate, readPr, runGate, saveGate } from './gate.mjs';
import {
  runCapture,
  runProductionOnly,
  runRecord,
  runSigninCommand,
  runStatus,
} from './capture.mjs';
import { launchBrowser, playwrightStatus, readSecrets, signIn, SigninError } from './signin.mjs';

const USAGE = `Usage:
  visual-qa.mjs setup --check
  visual-qa.mjs previews <pr> [--repo owner/name]
  visual-qa.mjs remember-preview <check> --covers <text> [--production <url>] [--login <name>] [--url <template>] [--repo owner/name]
  visual-qa.mjs approve-author <login>
  visual-qa.mjs approve-pr <pr> <item>... [--repo owner/name]
  visual-qa.mjs gate <pr> --preview <check> [--repo owner/name]
  visual-qa.mjs capture <pr> --preview <check> --scenario <file> [--demo] [--repo owner/name]
  visual-qa.mjs capture --production-only --url <url> --scenario <file> [--demo]
  visual-qa.mjs signin --origin <url> [--pr <n>] [--repo owner/name] [--headed]
  visual-qa.mjs record <pr> --status <passed|failed|skipped> [--reason <text>] [--run <dir>] [--repo owner/name]
  visual-qa.mjs status <pr> [--repo owner/name]`;

const VALUED = [
  'covers',
  'production',
  'login',
  'url',
  'repo',
  'preview',
  'scenario',
  'origin',
  'pr',
  'status',
  'reason',
  'run',
];
const BOOLEAN = ['check', 'demo', 'production-only', 'headed'];

class UsageError extends Error {}

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const key = a.slice(2);
    if (BOOLEAN.includes(key)) out[key] = true;
    else if (VALUED.includes(key)) {
      if (argv[i + 1] === undefined) throw new UsageError(`${a} needs a value.`);
      out[key] = argv[++i];
    } else throw new UsageError(`Unknown flag ${a}.`);
  }
  if (out.repo !== undefined && !/^[\w.-]+\/[\w.-]+$/.test(out.repo)) {
    throw new UsageError('--repo must look like owner/name.');
  }
  return out;
}

function defaultRepo() {
  const res = spawnSync('gh', ['repo', 'view', '--json', 'nameWithOwner'], { encoding: 'utf8' });
  if (res.status !== 0) throw new UsageError('Could not read the repo; pass --repo owner/name.');
  return JSON.parse(res.stdout).nameWithOwner;
}

async function setupCheck() {
  const config = loadConfig();
  const problems = validateConfig(config);
  const report = { ...playwrightStatus(), config: problems.length === 0, logins: {} };
  if (problems.length) report.problems = problems;
  const names = Object.keys(config.logins);
  if (names.length === 0) report.config = false;
  let browser = null;
  for (const name of names) {
    const login = config.logins[name];
    const entry = { secrets: false, signedIn: false };
    report.logins[name] = entry;
    try {
      readSecrets(login);
      entry.secrets = true;
    } catch (err) {
      entry.error = err.message;
      continue;
    }
    if (!report.playwright || !report.chromium) continue;
    try {
      browser ??= await launchBrowser();
      await signIn({ browser, login, origin: login.production });
      entry.signedIn = true;
    } catch (err) {
      if (err instanceof SigninError && err.code === 4) {
        entry.needs = 'sean';
        entry.reason = err.payload.reason;
        report.needsSean = true;
      } else entry.error = err.message;
    }
  }
  if (browser) await browser.close();
  const ok =
    report.playwright &&
    report.chromium &&
    report.config &&
    names.length > 0 &&
    names.every((n) => report.logins[n].secrets && report.logins[n].signedIn);
  return { code: ok ? 0 : report.needsSean ? 4 : 1, out: report };
}

function rememberPreviewCommand(args) {
  const [check, ...extra] = args._;
  if (!check || extra.length) throw new UsageError('remember-preview takes exactly <check>.');
  if (!args.covers) throw new UsageError('--covers is required.');
  const repo = args.repo ?? defaultRepo();
  const next = rememberPreview(loadConfig(), repo, check, {
    covers: args.covers,
    production: args.production,
    login: args.login,
    url: args.url,
  });
  const problems = validateConfig(next);
  if (problems.length) return { code: 2, out: { refused: true, problems } };
  saveConfig(next);
  return { code: 0, out: { repo, check, saved: next.repos[repo].previews[check] } };
}

function approveAuthorCommand(args) {
  const [login, ...extra] = args._;
  if (!login || extra.length) throw new UsageError('approve-author takes exactly <login>.');
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login)) {
    throw new UsageError('That does not look like a GitHub login.');
  }
  let next;
  try {
    next = approveAuthor(loadConfig(), login);
  } catch (err) {
    return { code: 2, out: { refused: true, reason: err.message } };
  }
  saveConfig(next);
  return { code: 0, out: { approvedAuthors: next.approvedAuthors } };
}

function prNumber(args, command) {
  const pr = args._[0];
  if (!/^[1-9][0-9]{0,8}$/.test(pr ?? '')) throw new UsageError(`${command} needs a PR number.`);
  return pr;
}

function previewsCommand(args) {
  const pr = prNumber(args, 'previews');
  if (args._.length > 1) throw new UsageError('previews takes exactly <pr>.');
  const repo = args.repo ?? defaultRepo();
  const configured = loadConfig().repos?.[repo]?.previews ?? {};
  const view = readPr(repo, pr);
  const list = findPreviews(view.statusCheckRollup).map((p) => ({
    name: p.name,
    url: p.url,
    state: 'success',
    config: configured[p.name] ?? null,
  }));
  // Configured previews that are not ready yet are listed with their state.
  for (const [name, config] of Object.entries(configured)) {
    if (list.some((p) => p.name === name)) continue;
    const check = findPreviewCheck(view.statusCheckRollup, name);
    if (check.state !== 'missing') list.push({ name, url: check.url, state: check.state, config });
  }
  return { code: 0, out: { pr: Number(pr), sha: view.headRefOid, repo, previews: list } };
}

function approvePrCommand(args) {
  const pr = prNumber(args, 'approve-pr');
  const items = args._.slice(1);
  if (items.length === 0) throw new UsageError('approve-pr needs at least one <item>.');
  const repo = args.repo ?? defaultRepo();
  let next;
  try {
    next = approvePr(loadGate(repo), pr, items);
  } catch (err) {
    return { code: 2, out: { refused: true, reason: err.message } };
  }
  saveGate(repo, next);
  return { code: 0, out: { pr: Number(pr), approvals: next.prs[pr].approvals } };
}

function gateCommand(args) {
  const pr = prNumber(args, 'gate');
  if (args._.length > 1) throw new UsageError('gate takes exactly <pr>.');
  if (!args.preview) throw new UsageError('--preview is required.');
  return runGate({ pr, repo: args.repo ?? defaultRepo(), previewKey: args.preview });
}

function captureCommand(args) {
  if (args['production-only']) {
    if (args._.length) throw new UsageError('--production-only takes no <pr>.');
    if (!args.url || !args.scenario) throw new UsageError('--url and --scenario are required.');
    return runProductionOnly({ url: args.url, scenarioFile: args.scenario, demo: args.demo });
  }
  const pr = prNumber(args, 'capture');
  if (args._.length > 1) throw new UsageError('capture takes exactly <pr>.');
  if (!args.preview || !args.scenario)
    throw new UsageError('--preview and --scenario are required.');
  return runCapture({
    pr,
    repo: args.repo ?? defaultRepo(),
    previewKey: args.preview,
    scenarioFile: args.scenario,
    demo: args.demo,
  });
}

function signinCommand(args) {
  if (args._.length) throw new UsageError('signin takes no positional arguments.');
  if (!args.origin) throw new UsageError('--origin is required.');
  if (args.pr !== undefined && !/^[1-9][0-9]{0,8}$/.test(args.pr)) {
    throw new UsageError('--pr must be a PR number.');
  }
  return runSigninCommand({
    origin: args.origin,
    pr: args.pr,
    repo: args.pr ? (args.repo ?? defaultRepo()) : args.repo,
    headed: args.headed,
  });
}

function recordCommand(args) {
  const pr = prNumber(args, 'record');
  if (args._.length > 1) throw new UsageError('record takes exactly <pr>.');
  if (!args.status) throw new UsageError('--status is required.');
  return runRecord({
    pr,
    repo: args.repo ?? defaultRepo(),
    status: args.status,
    reason: args.reason,
    run: args.run,
  });
}

function statusCommand(args) {
  const pr = prNumber(args, 'status');
  if (args._.length > 1) throw new UsageError('status takes exactly <pr>.');
  return runStatus({ pr, repo: args.repo ?? defaultRepo() });
}

const COMMANDS = {
  setup: (args) => {
    if (!args.check) throw new UsageError('setup needs --check.');
    return setupCheck();
  },
  'remember-preview': rememberPreviewCommand,
  'approve-author': approveAuthorCommand,
  previews: previewsCommand,
  'approve-pr': approvePrCommand,
  gate: gateCommand,
  capture: captureCommand,
  signin: signinCommand,
  record: recordCommand,
  status: statusCommand,
};

async function main() {
  const [name, ...rest] = process.argv.slice(2);
  try {
    if (!name || !(name in COMMANDS)) throw new UsageError('Unknown or missing command.');
    const { code, out } = await COMMANDS[name](parseArgs(rest));
    console.log(JSON.stringify(out, null, 2));
    process.exit(code);
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`${err.message}\n${USAGE}`);
      process.exit(2);
    }
    const code = err instanceof SigninError ? err.code : 1;
    console.log(JSON.stringify(err.payload ?? { error: err.message }));
    process.exit(code);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
