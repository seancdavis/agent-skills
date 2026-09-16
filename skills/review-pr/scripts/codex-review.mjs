#!/usr/bin/env node
// codex-review — run one strictly read-only Codex review pass over a PR branch,
// as a SINGLE clean command.
//
// The sibling of autopilot's codex-audit.mjs, with lenses aimed at reviewing
// someone else's PR rather than auditing work we just built. Same reasons for
// existing: no $(...) substitution and no inline prompt, so the command is
// allowlistable and one approval covers the whole review. Read-only is
// structural — it calls the Codex companion's `task` with NO `--write`, so the
// plugin forces sandbox=read-only.
//
// Usage:
//   node codex-review.mjs --lens <claims|correctness|security> --base <ref> [--claims-file <path>] [--context <text>] [--effort <level>] [--model <name>]
//   node codex-review.mjs --prompt "<custom read-only review prompt>" [...]

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
}

function findCompanion() {
  const cacheRoot = join(homedir(), '.claude', 'plugins', 'cache', 'openai-codex', 'codex');
  if (existsSync(cacheRoot)) {
    // Newest version dir wins.
    for (const v of readdirSync(cacheRoot).sort().reverse()) {
      const p = join(cacheRoot, v, 'scripts', 'codex-companion.mjs');
      if (existsSync(p)) return p;
    }
  }
  const marketplace = join(
    homedir(),
    '.claude',
    'plugins',
    'marketplaces',
    'openai-codex',
    'plugins',
    'codex',
    'scripts',
    'codex-companion.mjs',
  );
  return existsSync(marketplace) ? marketplace : null;
}

const LENSES = {
  claims:
    "Does the PR do what its description claims? Walk the description's claims one at a time against the code and report each that is unimplemented, half-implemented, or implemented differently than described. Also report changes the description never accounts for. Code that is PRESENT always looks fine — absence and divergence are what you are hunting, so account for every claim rather than reviewing what happens to be in the diff. Ignore style.",
  correctness:
    'Find real bugs. A finding needs a concrete failure case: inputs or state that produce the wrong result, a crash, or corrupt data. If you cannot name one, it is a suspicion and does not belong in the list. Read whole files and follow callers — a diff hides the function a change lives in and everything that calls it. Ignore style and security.',
  security:
    'Flag injection, authz/authn gaps, secret handling, unsafe input, SSRF, path traversal, user-supplied values reaching a query or a filesystem path, and data exposed across user boundaries. Ignore simplicity and style.',
};

function buildLensPrompt(args) {
  const lens = String(args.lens).toLowerCase();
  const framing = LENSES[lens];
  if (!framing) {
    console.error(`Unknown lens "${args.lens}". Known lenses: ${Object.keys(LENSES).join(', ')}.`);
    process.exit(2);
  }
  if (typeof args.base !== 'string') {
    console.error('--base <ref> is required — the branch this PR would merge into.');
    process.exit(2);
  }
  // Without the description the claims lens silently reviews the diff on its
  // own terms, which is a different job that looks like the one we asked for.
  if (lens === 'claims' && typeof args['claims-file'] !== 'string') {
    console.error("The claims lens requires --claims-file <path> holding the PR's description.");
    process.exit(2);
  }
  let claimsBlock = '';
  if (typeof args['claims-file'] === 'string') {
    if (!existsSync(args['claims-file'])) {
      console.error(`Claims file not found at "${args['claims-file']}".`);
      process.exit(2);
    }
    claimsBlock = `\n<pr_description>\n${readFileSync(args['claims-file'], 'utf8')}\n</pr_description>`;
  }
  const contextLine = args.context ? `\nReview context: ${args.context}.` : '';
  return `<task>
Review ONLY the changes on this branch versus ${args.base} (run: git diff ${args.base}...HEAD) for ${lens.toUpperCase()}. Read-only: do not modify any files.${contextLine}
${framing}
The author of this PR may be an agent. Its description is a claim, not a summary — check every claim against code you actually opened.
</task>${claimsBlock}
<structured_output_contract>
Findings ordered by severity. Each on its own, with these fields and no others: title; file:line; what is wrong (one sentence); evidence (what you opened and what it showed); severity (blocking|follow-up|consider|nit); confidence 0-1. If there are none, say so plainly. No preamble, no fix suggestions.
</structured_output_contract>
<grounding_rules>
Only claims the visible code supports. Label inferences as inferences. No speculation stated as fact.
</grounding_rules>
<dig_deeper_nudge>
One strong, well-evidenced finding beats several weak ones. Don't pad.
</dig_deeper_nudge>`;
}

const args = parseArgs(process.argv.slice(2));

let prompt;
if (args.lens) prompt = buildLensPrompt(args);
else if (args['prompt-file']) prompt = readFileSync(args['prompt-file'], 'utf8');
else if (args.prompt && typeof args.prompt === 'string') prompt = args.prompt;
else {
  console.error('Provide --lens <name>, --prompt <text>, or --prompt-file <path>.');
  process.exit(2);
}

const companion = findCompanion();
if (!companion) {
  console.error('Codex plugin not found under ~/.claude/plugins. Install it and run /codex:setup.');
  process.exit(1);
}

if (args['dry-run']) {
  console.log(`companion: ${companion}`);
  console.log(`read-only: yes (task, no --write)\n`);
  console.log(prompt);
  process.exit(0);
}

// `task` with NO `--write` => the companion forces sandbox=read-only, approvalPolicy=never.
const taskArgs = [companion, 'task'];
if (args.model) taskArgs.push('--model', String(args.model));
if (args.effort) taskArgs.push('--effort', String(args.effort));
taskArgs.push(prompt);

const res = spawnSync('node', taskArgs, { stdio: ['ignore', 'inherit', 'inherit'] });
process.exit(res.status ?? 0);
