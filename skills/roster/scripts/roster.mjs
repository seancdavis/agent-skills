#!/usr/bin/env node
// roster — summarize which model each subagent in a Claude Code session ran on.
//
// Reads the session's subagent transcripts and prints ONLY a compact table
// (agent -> model -> generated tokens -> tool calls). It never writes transcript
// content to stdout, so the caller's context window stays clear.
//
// Usage:
//   node roster.mjs [sessionId]
// Defaults to $CLAUDE_CODE_SESSION_ID (the current session) when no id is given.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const sessionId = process.argv.slice(2).find((a) => !a.startsWith("-")) || process.env.CLAUDE_CODE_SESSION_ID;

if (!sessionId) {
  console.error("No session id. Pass one as an argument, or run inside a Claude Code session (CLAUDE_CODE_SESSION_ID).");
  process.exit(1);
}

// Find the session's subagents dir. Session ids are unique, so scan every project.
const projectsRoot = join(homedir(), ".claude", "projects");
let subagentsDir = null;
if (existsSync(projectsRoot)) {
  for (const project of readdirSync(projectsRoot)) {
    const candidate = join(projectsRoot, project, sessionId, "subagents");
    if (existsSync(candidate)) {
      subagentsDir = candidate;
      break;
    }
  }
}

if (!subagentsDir) {
  console.log(`No subagents recorded for session ${sessionId} — nothing dispatched yet.`);
  process.exit(0);
}

const shortModel = (m) =>
  m ? m.replace(/^claude-/, "").replace(/-\d{8}$/, "") : "(unknown)";

const files = readdirSync(subagentsDir).filter((f) => f.startsWith("agent-") && f.endsWith(".jsonl"));
const rows = [];

for (const file of files) {
  let model = null;
  let genTokens = 0;
  let toolCalls = 0;

  const lines = readFileSync(join(subagentsDir, file), "utf8").split("\n");
  for (const line of lines) {
    if (!line) continue;
    // Only trust model/usage on assistant turns, so tool output that happens to
    // echo these fields doesn't skew the numbers.
    if (line.includes('"type":"assistant"')) {
      const m = line.match(/"model":"([^"]+)"/);
      if (m) model = m[1];
      const out = line.match(/"output_tokens":(\d+)/);
      if (out) genTokens += Number(out[1]);
    }
    const tools = line.match(/"type":"tool_use"/g);
    if (tools) toolCalls += tools.length;
  }

  rows.push({
    id: file.replace(/^agent-/, "").replace(/\.jsonl$/, ""),
    model,
    genTokens,
    toolCalls,
  });
}

if (rows.length === 0) {
  console.log(`No subagent transcripts in ${subagentsDir}.`);
  process.exit(0);
}

rows.sort((a, b) => b.genTokens - a.genTokens);

const padR = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

console.log(`Session ${sessionId} — ${rows.length} subagent(s)\n`);
console.log(padR("agent", 12) + padR("model", 14) + padL("gen tok", 9) + padL("tools", 8));
console.log("-".repeat(43));
for (const r of rows) {
  console.log(padR(r.id.slice(0, 10), 12) + padR(shortModel(r.model), 14) + padL(r.genTokens, 9) + padL(r.toolCalls, 8));
}

const byModel = {};
for (const r of rows) {
  const key = shortModel(r.model);
  byModel[key] = byModel[key] || { agents: 0, genTokens: 0 };
  byModel[key].agents += 1;
  byModel[key].genTokens += r.genTokens;
}

console.log("\nby model:");
for (const [model, v] of Object.entries(byModel).sort((a, b) => b[1].genTokens - a[1].genTokens)) {
  console.log(`  ${padR(model, 12)} ${v.agents} agent(s), ${v.genTokens} gen tok`);
}

console.log(
  "\nNote: covers native Claude subagents only. Codex work runs as a subprocess — inspect it with /codex:status."
);
