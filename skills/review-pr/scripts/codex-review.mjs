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
//   node codex-review.mjs --lens <problem|correctness|security> --base <ref> --problem-file <path> [--claims-file <path>] [--ci-file <path>] [--context <text>] [--effort <level>] [--model <name>]
//
// --problem-file holds what the PR is meant to solve: the linked issue or the
// reviewer's own statement, plus their notes on the author's decisions. Every
// lens needs it, because "normal use" and "blocking" are judged against it.
// --claims-file holds the PR description — the author's claims, never the
// problem statement.
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
  problem:
    "Does the PR solve the problem in <problem>? Walk that problem one requirement at a time against the code and report each that is unsolved, half-solved, or solved differently than the problem asks. Then walk the description's claims in <pr_description>, if provided, the same way, and report changes neither the problem nor the description accounts for. Code that is PRESENT always looks fine — absence and divergence are what you are hunting, so account for every requirement rather than reviewing what happens to be in the diff. Ignore style.",
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
  // Without the problem, a pass judges the PR by its own description, and the
  // fix becomes the context it's checked against.
  if (typeof args['problem-file'] !== 'string') {
    console.error(
      "--problem-file <path> is required — the linked issue or the reviewer's statement of the problem.",
    );
    process.exit(2);
  }
  if (!existsSync(args['problem-file'])) {
    console.error(`Problem file not found at "${args['problem-file']}".`);
    process.exit(2);
  }
  const problemBlock = `\n<problem>\n${readFileSync(args['problem-file'], 'utf8')}\n</problem>`;
  let claimsBlock = '';
  if (typeof args['claims-file'] === 'string') {
    if (!existsSync(args['claims-file'])) {
      console.error(`Claims file not found at "${args['claims-file']}".`);
      process.exit(2);
    }
    claimsBlock = `\n<pr_description>\n${readFileSync(args['claims-file'], 'utf8')}\n</pr_description>`;
  }
  // Read-only stops edits, not execution — without this, Codex re-runs the
  // suite CI already ran, and that's most of a pass's wall-clock.
  let ciBlock = '';
  let ciLine =
    'No CI results were provided. If a finding depends on whether something passes, mark it uncertain rather than running it.';
  if (typeof args['ci-file'] === 'string') {
    if (!existsSync(args['ci-file'])) {
      console.error(`CI file not found at "${args['ci-file']}".`);
      process.exit(2);
    }
    ciBlock = `\n<ci_results>\n${readFileSync(args['ci-file'], 'utf8')}\n</ci_results>`;
    ciLine =
      'CI results are in <ci_results> below — treat them as the evidence for anything running the code would tell you.';
  }
  const contextLine = args.context ? `\nReview context: ${args.context}.` : '';
  return `<task>
Review ONLY the changes on this branch versus ${args.base} (run: git diff ${args.base}...HEAD) for ${lens.toUpperCase()}. Read-only: do not modify any files.
Do not run tests, builds, installs, or project scripts — CI already ran them. Reading commands (git, grep, opening files) are fine. ${ciLine}${contextLine}
${framing}
<problem> below is what this PR is meant to solve; judge the change against it. The author of this PR may be an agent. Its description is a claim, not a summary — check every claim against code you actually opened.
Before raising a question, try to answer it yourself from the code, <problem>, git history, and CI. If you find the answer, it is a finding or nothing. Only questions about intent — what the author or the team meant, which no file can tell you — survive.
</task>${problemBlock}${claimsBlock}${ciBlock}
<definitions>
blocking: the change does not solve <problem>, breaks the main path for someone using the feature normally, loses or exposes data, or CI is failing. Nothing else is blocking, however good the point.
edge case: a failure that someone using the feature normally, as <problem> intends, would not hit, AND that is visible and recoverable when hit (an error they can see and retry past). A failure that is silent or unrecoverable — lost data, wrong data shown with no error, a security hole — is never an edge case, however rare.
</definitions>
<structured_output_contract>
Findings ordered by importance. Each on its own, with these fields and no others: title; file:line (and any other locations with the same problem); what is wrong (one sentence, in terms of what someone using the product would notice where possible); trigger (the input or steps that produce it, for anything that fails); evidence (what you opened and what it showed); blocking (yes | no); edge case (yes | no); confidence 0-1.
Then, separately, any intent questions that survived, one line each with the file:line they concern.
If there are no findings, say so plainly. No preamble, no fix suggestions.
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
