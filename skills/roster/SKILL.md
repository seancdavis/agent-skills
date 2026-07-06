---
name: roster
description: Show which model each subagent in the current Claude Code session ran on, with generated-token and tool-call volume — a compact after-the-fact table for tuning model routing. Invoke with `/roster` after a run that dispatched subagents (anything using preflight/autopilot/research, or any Agent/Task fan-out) to see the model-per-agent breakdown Claude Code doesn't surface live. Reads the session's subagent transcripts via a script and returns ONLY the summary, keeping the context window clear. Optional argument: a session id, to inspect a different session.
---

# Roster — who ran on what

Claude Code shows subagents running live but never says which model each is on. Roster closes that gap after the run: it reads the session's subagent transcripts and prints a compact **model-per-agent** table — the feedback you use to tune routing. *Was that whole-project scan really on Opus? Should it have been Haiku, or Codex?*

The point is the summary, not the transcripts. The extractor aggregates the (large) transcript files with a script and surfaces **only the table** — it never reads transcript content into the conversation, so your context window stays clear. That's the whole reason this beats having the skills narrate every delegation inline.

## Run it

```sh
node "${CLAUDE_PLUGIN_ROOT}/skills/roster/scripts/roster.mjs"
```

Defaults to the current session (`$CLAUDE_CODE_SESSION_ID`). Pass a session id as an argument to inspect a different one. Print the table it returns as-is; don't go reading the underlying transcripts to "add detail" — that reintroduces exactly the context bloat this avoids.

## Reading the output

- **agent** — the subagent's id (matches the `agent-<id>.jsonl` transcript on disk).
- **model** — the model that subagent actually ran on. This is the answer to "what are we using for each one."
- **gen tok** — output (generated) tokens, summed across the subagent's turns. A clean signal of how much work it did; the biggest rows are where routing choices matter most.
- **tools** — tool calls made.
- **by model** — the rollup. If the expensive tier dominates generated tokens on commodity work, that's your cue to route it down (a cheaper subagent tier, or Codex).

## Caveat — it sees Claude subagents only

Roster covers **native Claude subagents** (the developer, planners, and scanners that `preflight`/`autopilot`/`research` dispatch). It does **not** see Codex: Codex runs as a subprocess, not a subagent, so it leaves no `agent-*.jsonl`. Inspect Codex jobs separately with `/codex:status` and `/codex:result`. Between the two you get the full roster across both vendors.

## When to use

- After any subagent-heavy run, to check the routing did what you intended.
- When a run felt expensive — the `by model` rollup shows where the tokens went.

Not useful when nothing was delegated (a run with no subagents has nothing to report).

## Related skills

- `preflight` / `autopilot` / `research` — the skills whose delegations this makes visible.
