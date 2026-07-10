#!/usr/bin/env node
// codex-audit — run a strictly read-only Codex pass as a SINGLE clean command.
//
// Why this exists: invoking Codex inline needs a $(...) command substitution to
// locate the plugin script, plus a long prompt — a compound shell command that
// Claude Code can never allowlist, so it prompts every time and blocks an
// unattended run. This wrapper resolves the path in Node (no shell substitution)
// and builds the prompt internally, so the command is just:
//
//   node codex-audit.mjs --lens security --base main
//
// which is a single, allowlistable command. The Codex processes it spawns run
// INSIDE this script, so they never hit Claude Code's permission layer — one
// approval covers the whole audit. Read-only is structural: it calls the Codex
// companion's `task` with NO `--write`, so the plugin forces sandbox=read-only.
//
// Usage:
//   node codex-audit.mjs --lens <simplicity|security> [--base <ref>] [--scope <text>] [--context <text>] [--effort <level>] [--model <name>]
//   node codex-audit.mjs --prompt "<custom read-only review prompt>" [...]
//   node codex-audit.mjs --prompt-file <path> [...]

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[key] = true;
      else {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
}

function findCompanion() {
  const cacheRoot = join(homedir(), ".claude", "plugins", "cache", "openai-codex", "codex");
  if (existsSync(cacheRoot)) {
    // Newest version dir wins.
    for (const v of readdirSync(cacheRoot).sort().reverse()) {
      const p = join(cacheRoot, v, "scripts", "codex-companion.mjs");
      if (existsSync(p)) return p;
    }
  }
  const marketplace = join(
    homedir(), ".claude", "plugins", "marketplaces", "openai-codex", "plugins", "codex", "scripts", "codex-companion.mjs"
  );
  return existsSync(marketplace) ? marketplace : null;
}

const LENSES = {
  simplicity:
    "Is this the simplest correct implementation? Flag unnecessary complexity, dead code, needless abstraction, over-engineering, and duplication. Ignore security and style.",
  security:
    "Flag injection, authz/authn gaps, secret handling, unsafe input, SSRF, path traversal, and similar vulnerabilities. Ignore simplicity and style.",
};

function scopeClause(args) {
  if (args.base) return `the changes on this branch versus ${args.base} (run: git diff ${args.base}...HEAD)`;
  if (args.scope) return args.scope;
  return "the uncommitted working-tree changes (run: git diff)";
}

function buildLensPrompt(args) {
  const lens = String(args.lens).toLowerCase();
  const framing = LENSES[lens];
  if (!framing) {
    console.error(`Unknown lens "${args.lens}". Known lenses: ${Object.keys(LENSES).join(", ")}.`);
    process.exit(2);
  }
  const contextLine = args.context ? `\nWork context: ${args.context}.` : "";
  return `<task>
Review ONLY ${scopeClause(args)} for ${lens.toUpperCase()}. Read-only: do not modify any files.${contextLine}
${framing}
</task>
<structured_output_contract>
Findings ordered by severity (critical->low). Each: title; file:line; what's wrong; why it matters; concrete fix; confidence 0-1. If there are none, say so plainly. No preamble.
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
else if (args["prompt-file"]) prompt = readFileSync(args["prompt-file"], "utf8");
else if (args.prompt && typeof args.prompt === "string") prompt = args.prompt;
else {
  console.error("Provide --lens <name>, --prompt <text>, or --prompt-file <path>.");
  process.exit(2);
}

const companion = findCompanion();
if (!companion) {
  console.error("Codex plugin not found under ~/.claude/plugins. Install it and run /codex:setup.");
  process.exit(1);
}

if (args["dry-run"]) {
  console.log(`companion: ${companion}`);
  console.log(`read-only: yes (task, no --write)\n`);
  console.log(prompt);
  process.exit(0);
}

// `task` with NO `--write` => the companion forces sandbox=read-only, approvalPolicy=never.
const taskArgs = [companion, "task"];
if (args.model) taskArgs.push("--model", String(args.model));
if (args.effort) taskArgs.push("--effort", String(args.effort));
taskArgs.push(prompt);

const res = spawnSync("node", taskArgs, { stdio: ["ignore", "inherit", "inherit"] });
process.exit(res.status ?? 0);
