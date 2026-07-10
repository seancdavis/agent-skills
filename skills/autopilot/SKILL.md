---
name: autopilot
description: The unattended build-and-audit run — the "you're gone" half of the flow. Invoked by `preflight`'s handoff, or with `/autopilot` pointed at a settled spec, when Sean has walked away. The orchestrator coordinates without writing code or auditing itself: it dispatches a Claude developer subagent to implement per the spec, fires Codex as a strictly read-only auditor on focused simplicity and security passes, triages the findings with judgment, loops real fixes back to the developer, and leaves a report for Sean's return. Works on a branch and ends by opening a draft PR (which fires the deploy preview) for the human's review; never merges or deploys. The auditor never fixes. For the interactive setup that precedes this, see `preflight`.
---

# Autopilot — the unattended run

Nobody is watching. Sean set the work up in `preflight`, hit the walk-away line, and left. Your job is to run the back half — implement, audit, triage, fix, repeat — and have a clean report waiting when he's back to do his manual test. The value of this skill is that the audit no longer waits on Sean being at the keyboard; it happens automatically as the tail of the run.

## Three rules that don't bend

1. **The orchestrator judges — it does not write code, and it does not audit.** You dispatch a developer to write and Codex to audit. Your work is the judgment *between* their outputs. You stay out of writing so you can weigh the audit impartially; you stay out of auditing so a second, independent model catches what you'd miss.
2. **The auditor is read-only, always.** Codex reviews and reports. It never edits. This is structural (see the invocation below), not a promise — but never route audits through anything that can write.
3. **Never ship.** Work on a branch and commit at clean points. Ending the run means pushing the branch and opening a **draft PR** for review (Phase 5) — that's the handoff, not the ship. Never merge the PR and never deploy; those stay the human's calls after review.

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

Each pass is a **single, allowlistable command** — the wrapper script resolves the Codex plugin path and builds the prompt internally, so there's no `$(…)`/pipe for Claude Code to choke on, and the whole audit runs on one permission approval:

```sh
node "${CLAUDE_PLUGIN_ROOT}/skills/autopilot/scripts/codex-audit.mjs" --lens security --base main
```

- `--lens simplicity` or `--lens security` — one lens per run; the prompt template lives in the script.
- `--base <ref>` reviews the branch against a base (`git diff <ref>...HEAD`); omit it to review the uncommitted working tree, or pass `--scope "<text>"` to describe the range.
- Follow-up passes: add `--context "the developer just changed X to address prior findings; check against history"` so Codex focuses on what changed rather than re-reviewing everything.
- For a freeform (non-lens) review, pass `--prompt "<text>"` or `--prompt-file <path>` instead of `--lens`.

**Read-only is structural:** the script calls the companion's `task` with **no `--write`**, so the plugin forces `sandbox: "read-only"` / `approvalPolicy: "never"` — Codex cannot edit or even prompt to edit. The lens prompt templates (compact, XML-blocked, one job per run) live in `codex-audit.mjs`; tune them there. The model is left unset so Codex uses your `~/.codex/config.toml` default (pin `gpt-5.5` there if desired); pass `--model`/`--effort` to override.

## Phase 3 — Triage (this is where you earn your keep)

Codex hands back raw findings. **Never pass them downstream as-is.** For each finding, judge:

- **Is it real?** Open the code and confirm. Codex is confident even when wrong; low-confidence findings especially need checking.
- **Is it in scope and material?** Drop nits, style bikeshedding, and things outside the spec's intent. Simplicity findings that would *add* complexity to satisfy get dropped.
- **Did Codex fixate?** If it spent the whole pass on one detail, ask what it likely missed and whether a second angle is worth a pass.
- **Does it invalidate a spec assumption?** A finding is evidence about the *spec*, not just the code. When one shows the spec was wrong about something — its file list, its scope, an assumption it rested on — don't just fix the found instance: re-derive the **class**. Re-run, yourself and repo-wide, the check that assumption was built on (e.g. preflight's reference sweep) and fold in whatever else it surfaces *before* closing the round. Confirming the one finding and moving on is exactly how a single under-scoped sweep survives every downstream layer. It's read-only work — judgment, not editing — so it stays within the rules.

Produce a **judged action list** ranked by severity — only the findings a developer should actually act on, each with your reasoning. This list, not the Codex dump, is what moves forward.

## Phase 4 — Fix loop

Send the judged findings back to the **developer** subagent to fix (again: you don't fix them yourself). Then re-audit — the follow-up passes are diff-focused: "here's what changed, check it against history." Loop until both lenses come back clean **or** you hit the spec's loop bound (default 3 rounds). Don't loop forever chasing a zero while Sean's away; a bounded stop with an honest report is the correct outcome.

## Phase 5 — Open the PR and stop

Close the run by handing off through the `open-pr` skill: push the branch and open a **draft PR** for review. On Netlify (and similar), the PR is what triggers the deploy preview Sean needs for his smoke test — so opening it *is* the handoff, not a violation of "never ship."

The PR body is the report, kept to `open-pr`'s concise convention (summary + what changed), plus a short **verify** note carrying the two things Sean most needs:

- **What to check** — the deploy-preview smoke test, and specifically anything the run *couldn't* self-verify (e.g. DB-query wiring, `.astro` UX where the repo has no route/query tests by convention).
- **Findings deferred** — anything real you chose not to fix, and why.

Keep the deeper detail (full audit history, per-round findings) in `docs/autopilot/{YYYY-MM-DD}-{slug}-report.md` and link it from the PR rather than pasting it all in — the PR stays skimmable.

Then stop. Never merge the PR and never deploy — Sean reviews the preview and ships.

## Guardrails, in one place

- Work on a branch; commit at clean points; end by pushing + opening a **draft PR** (via `open-pr`). Never merge or deploy.
- Orchestrator never edits code and never audits.
- Auditor is read-only (`task` without `--write`); developer and auditor are different models.
- Bounded loop; stop-and-note on anything the spec can't resolve.

## Permissions — how to launch it unattended

Autopilot only walks away cleanly if nothing blocks on a human approval — and the Codex audit is just the first of several: the developer subagent's edits, the test run, and the git commits would all prompt too. Two ways to run it:

- **Unattended → bypass-in-a-sandbox.** Launch the session in bypass-permissions mode. That sounds reckless but it fits autopilot's design: it works on a branch, opens only a draft PR (never merges or deploys), and you review before it ships — so the blast radius is one branch you inspect. Lean on the guardrails as the safety net instead of approving command by command.
- **Attended → allowlist the audit command.** When you're around, a `permissions.allow` rule for the `codex-audit.mjs` wrapper stops the audit from nagging while everything else still prompts (the recommended entries live in your user settings). This works only because the audit is a single clean `node …` command — a compound `$(…)`/piped command can't be allowlisted at all.

Either way the read-only auditor guarantee holds: `task` without `--write` can't modify files regardless of permission mode.

## Related skills

- `preflight` — the interactive setup and spec that this consumes.
- `grill-me` / `paper-trail` — heavier alignment and session logging, upstream of preflight.
