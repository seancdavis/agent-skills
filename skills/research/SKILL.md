---
name: research
description: Cost-effective broad investigation — surveying a whole codebase for gaps, mapping an unfamiliar area, or answering a question where the *reading* is the expensive part. Invoke with `/research` (naming the target or question) when the work is broad and token-heavy and the goal is to do MORE of it for less. The high-taste orchestrator scopes the question and synthesizes the answer; the breadth — the actual scanning and reading — is delegated to cheap, focused models (Sonnet/Haiku subagents in parallel, or Codex read-only for very broad passes), never done by the expensive orchestrator itself. Reach for this instead of letting the top model read everything and watching tokens evaporate. NOT for a targeted single-file lookup (just read it) and NOT web deep-research (that's a different tool).
---

# Research — breadth without the burn

This skill exists for one reason: **the expensive model must not do the reading.** When you point a top-tier model at "scan this whole project and find the gaps," it burns tokens fast doing commodity work — reading files — where errors don't compound and a cheaper model would do fine. Research flips that: the orchestrator (this session) decomposes and synthesizes; cheap, focused models do the scanning.

Same routing principle as `autopilot`'s audit — a read-only workhorse does the broad pass, the high-taste model does the judgment. Here it's aimed at breadth instead of build.

## The rule

The orchestrator scopes the question and synthesizes the findings. It does **not** read the corpus itself. If you catch yourself opening file after file to "get a feel," stop — that's the exact spend this skill is meant to avoid. Decompose and delegate instead.

## The roster

- **Orchestrator** — this session (high-taste). Decomposes the question, dispatches scanners, and synthesizes. Its only heavy lift is the synthesis.
- **Scanners** — cheap and focused:
  - **Sonnet / Haiku subagents** (`Agent`, model `sonnet` or `haiku`) run in parallel, one per slice. Default for a decomposable question.
  - **Codex, read-only** for a single very broad sweep — generous limits make it well suited to "read across everything once." Reuse `autopilot`'s read-only wrapper (a single, allowlistable command — no `$(…)`/pipe to trip a permission prompt); pass the scan as a freeform prompt instead of a lens:
    ```sh
    node "${CLAUDE_PLUGIN_ROOT}/skills/autopilot/scripts/codex-audit.mjs" --prompt "<scan question>"
    ```
    Use `--prompt-file <path>` for a long scan brief. It runs `task` with no `--write`, so Codex is structurally read-only.

## Flow

### 1. Scope and decompose

Turn the request into a **small set of focused, parallel slices** — by area, directory, subsystem, or concern. Each slice must be a self-contained question a cheap scanner can answer on its own and return *structured*, not a wall of prose. "Find gaps across the project" becomes, say, six slices: auth, data layer, error handling, tests, config, and docs — each scanned independently.

### 2. Dispatch cheap scanners

Send one scanner per slice, in parallel, on a cheap tier. Give each a tight brief and a structured return contract: findings, evidence (`file:line` or area), and a confidence. **Bound the count** — pick the slices that matter; don't spawn thirty. For a broad single-pass survey where slicing is awkward, use one Codex read-only sweep instead.

If you have to cap coverage — skip a directory, sample instead of exhaust — **say so in the report.** Silent truncation reads as "we covered everything" when you didn't.

### 3. Synthesize

This is the orchestrator's job and the only place the expensive model does real work. Merge the scanner returns, dedupe, resolve disagreements, rank by importance, and apply judgment — a scanner's "gap" may be intentional, out of scope, or wrong. **Don't just concatenate the returns;** a stapled-together pile of scanner output is the raw-dump anti-pattern, not a synthesis.

### 4. Report

Deliver ranked findings/gaps with pointers, separating what's well-evidenced from what's inferred, and what to do about each. Note any coverage you deliberately left out.

## Cost guardrails, in one place

- Scanners are cheap (Sonnet/Haiku) or Codex read-only — **never** an expensive-model fan-out for reading.
- Orchestrator synthesizes; it does not read the corpus.
- Bound the scanner count; declare any coverage you dropped.
- Scanners return structured findings, not raw dumps; the orchestrator turns those into an answer.

## When NOT to use research

- **A targeted lookup** — you know the file or symbol. Just read it; delegating is slower and pointless.
- **Web deep-research** — that's the separate `deep-research` tool. This skill is about breadth over a corpus you already have (usually a codebase).

## Related skills

- `autopilot` — same routing principle (read-only workhorse scans, orchestrator judges), aimed at build-and-audit.
- `preflight` — the interactive front gate for that flow.
