---
name: autopilot
description: The unattended build-and-audit run — the "you're gone" half of the flow. Invoked by `preflight`'s handoff, or with `/autopilot` pointed at a settled spec, when Sean has walked away. The orchestrator coordinates without writing code or auditing itself: it dispatches a Claude developer subagent to implement per the spec, fires Codex as a strictly read-only auditor on focused simplicity and security passes, triages the findings with judgment, loops real fixes back to the developer, and leaves a report for Sean's return. Works on a branch; never pushes, opens PRs, or deploys. The auditor never fixes. For the interactive setup that precedes this, see `preflight`.
---

# Autopilot — the unattended run

Nobody is watching. Sean set the work up in `preflight`, hit the walk-away line, and left. Your job is to run the back half — implement, audit, triage, fix, repeat — and have a clean report waiting when he's back to do his manual test. The value of this skill is that the audit no longer waits on Sean being at the keyboard; it happens automatically as the tail of the run.

## Three rules that don't bend

1. **The orchestrator judges — it does not write code, and it does not audit.** You dispatch a developer to write and Codex to audit. Your work is the judgment *between* their outputs. You stay out of writing so you can weigh the audit impartially; you stay out of auditing so a second, independent model catches what you'd miss.
2. **The auditor is read-only, always.** Codex reviews and reports. It never edits. This is structural (see the invocation below), not a promise — but never route audits through anything that can write.
3. **Never ship.** Work on a branch, commit at clean points, and stop. No push, no PR, no deploy. That's Sean's call when he's back.

## Preconditions — fail safe, because no one's here

- **A settled spec must exist** (from `preflight`, at `docs/autopilot/…`, or passed in). If it's missing, thin, or ambiguous, **do not proceed** — leave a note saying what's unclear and stop. An unattended run on a vague spec does unattended damage.
- **Be on a branch.** Create the one named in the spec if it doesn't exist. Never run this on `main`.
- **When you hit something the spec doesn't cover and you can't resolve from it, stop and record it.** Don't guess to keep moving. A clear "blocked on X" beats a confident wrong turn Sean has to unwind.

## The roster

- **Orchestrator** — this session (Sean's model; Opus or Fable). Coordinates and judges.
- **Developer** — a Claude subagent (`Agent`, model `sonnet`; escalate to `opus` for a hard spec). Writes and fixes code.
- **Auditor** — Codex / GPT (via the read-only invocation below). Reviews only.

The developer and the auditor must be **different models** — that's what makes the audit independent. Since Codex is the auditor, Claude is the developer. (This is the deliberate inverse of the "GPT builds, Claude tastes" setup; here Claude builds and GPT checks.)

## Phase 1 — Implement

Dispatch the developer subagent with the spec, the branch, and the plan. Tell it to implement to the done-signal, commit at clean points, and **not** push or open a PR. Let it run. You do not edit files yourself — if you're tempted to "just fix this one line," that's the rule-1 violation that collapses your independence.

## Phase 2 — Audit (Codex, read-only, focused, separate passes)

Run **one Codex pass per lens** — simplicity and security as *separate* invocations. Never fold multiple lenses into one prompt; a mixed review is Codex's documented failure mode and yours (it fixates on one thread and the rest slides past).

Resolve the companion script path once:

```sh
CODEX_COMPANION="$(find ~/.claude/plugins/cache/openai-codex/codex -name codex-companion.mjs -path '*/scripts/*' 2>/dev/null | sort | tail -1)"
[ -z "$CODEX_COMPANION" ] && CODEX_COMPANION="$HOME/.claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/codex-companion.mjs"
```

Invoke each pass with `task` and **no `--write` flag** — that is the read-only guarantee (the plugin sets `sandbox: "read-only"`, `approvalPolicy: "never"` for any `task` without `--write`; Codex then cannot edit or even prompt to edit):

```sh
node "$CODEX_COMPANION" task "<prompt>"
```

Prompt shape (Codex responds best to compact, XML-blocked, operator-style prompts — one job per run):

```
<task>
Review ONLY the changes on this branch for [LENS]. Read-only: do not modify any files.
Scope: [first pass: the work described below / follow-up pass: the developer just changed
{files} to address prior findings — check those against the history and confirm the concern
is resolved without introducing new [LENS] issues].
Work context: {one-paragraph summary of what was built, from the spec}.
[LENS framing:
 - simplicity → Is this the simplest correct implementation? Flag unnecessary complexity,
   dead code, needless abstraction, over-engineering, duplication. Ignore security and style.
 - security → Flag injection, authz/authn gaps, secret handling, unsafe input, SSRF, path
   traversal, and similar. Ignore simplicity and style.]
</task>
<structured_output_contract>
Findings ordered by severity (critical→low). Each: title; file:line; what's wrong; why it
matters; concrete fix; confidence 0–1. If there are none, say so plainly. No preamble.
</structured_output_contract>
<grounding_rules>
Only claims the visible code supports. Label inferences as inferences. No speculation stated
as fact.
</grounding_rules>
<dig_deeper_nudge>
One strong, well-evidenced finding beats several weak ones. Don't pad.
</dig_deeper_nudge>
```

Leave the model unset so Codex uses Sean's `~/.codex/config.toml` default (pin `gpt-5.5` there if desired). For a long audit, add `--background` and collect with the companion's `status`/`result` subcommands.

## Phase 3 — Triage (this is where you earn your keep)

Codex hands back raw findings. **Never pass them downstream as-is.** For each finding, judge:

- **Is it real?** Open the code and confirm. Codex is confident even when wrong; low-confidence findings especially need checking.
- **Is it in scope and material?** Drop nits, style bikeshedding, and things outside the spec's intent. Simplicity findings that would *add* complexity to satisfy get dropped.
- **Did Codex fixate?** If it spent the whole pass on one detail, ask what it likely missed and whether a second angle is worth a pass.

Produce a **judged action list** ranked by severity — only the findings a developer should actually act on, each with your reasoning. This list, not the Codex dump, is what moves forward.

## Phase 4 — Fix loop

Send the judged findings back to the **developer** subagent to fix (again: you don't fix them yourself). Then re-audit — the follow-up passes are diff-focused: "here's what changed, check it against history." Loop until both lenses come back clean **or** you hit the spec's loop bound (default 3 rounds). Don't loop forever chasing a zero while Sean's away; a bounded stop with an honest report is the correct outcome.

## Phase 5 — Report and stop

Write a report to `docs/autopilot/{YYYY-MM-DD}-{slug}-report.md` and summarize it in chat for when Sean returns:

- **What was built** — against the spec's intent and done-signal.
- **Audit history** — the passes run, per lens, per round.
- **Findings** — fixed vs. deliberately deferred, each with why (this is your judgment on the record).
- **Residual risks** — what you'd want Sean to look at during his manual test.
- **Branch** — its name and state, ready for him to test and ship.

Then stop. Do not push, PR, or deploy.

## Guardrails, in one place

- Branch only; commit at clean points; never push/PR/deploy.
- Orchestrator never edits code and never audits.
- Auditor is read-only (`task` without `--write`); developer and auditor are different models.
- Bounded loop; stop-and-note on anything the spec can't resolve.

## Related skills

- `preflight` — the interactive setup and spec that this consumes.
- `grill-me` / `paper-trail` — heavier alignment and session logging, upstream of preflight.
