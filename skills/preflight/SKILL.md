---
name: preflight
description: The front gate for an unattended build-and-audit run. Invoke with `/preflight` (optionally naming the work) when Sean wants to set up a piece of work thoroughly enough that he can walk away while it gets built and audited without him. Interactive alignment: pin intent, scope, plan, and the done-signal; ensure the work is backed by a tracked issue and a branch named for it; optionally hand planning to a cheaper model; write a settled spec to `docs/autopilot/`; then hand off to `autopilot`. This is the "you're here" half of the flow — `autopilot` is the "you're gone" half. NOT for work Sean intends to babysit step by step (just do that directly), and NOT the place for heavy open-ended design alignment (that's `grill-me`).
---

# Preflight — the front gate

Preflight is the human-present half of an unattended run. Sean is at the keyboard now; the point of this phase is to get the work understood well enough that he can leave and `autopilot` will build it, have Codex audit it, and leave a report — all without him. Everything preflight does is in service of one moment: saying **"I have what I need — you can walk away,"** and meaning it.

The orchestrator (this session) never writes the code and never audits it. Preflight's job is upstream of both: make the work legible enough to hand off.

## The bar

Drive to the same standard `grill-me` uses: **you could write the PR description right now** — title, summary, test plan — and be confident every line is right. Restated for this flow: *could `autopilot` run this to completion, unattended, without guessing?* If any answer is "it would have to guess," you're not done. Guessing is cheap when Sean is sitting here to correct it and expensive when he's gone.

Don't stop at "I think I get it." If something Sean said has two readings, surface it now — this is the last cheap moment to.

## What you're pinning

Not a fixed questionnaire — a free-form conversation that lands these:

- **Intent** — the outcome, not the task. After this runs, Sean's situation is _Y_.
- **Scope** — what's in, what's explicitly out. Where autopilot should stop rather than wander.
- **The plan** — the concrete steps/approach. Solid enough that a developer subagent could follow it. If it doesn't exist yet, see below.
- **Done-signal** — how autopilot knows it's finished. Tests green? A specific behavior working? A checklist satisfied? Without this, an unattended run has no stop condition.
- **Audit lenses** — default is **simplicity** and **security** (Codex, read-only, one pass each). Add or swap lenses if this work needs it; drop the design lens for now unless Sean asks.
- **Backing issue + branch** — the tracked issue this work answers to, and a branch named for it. If neither exists yet, this is where they get created (see below). autopilot builds on the branch; `open-pr` links/closes the issue.
- **Guardrails** — the loop bound (default: 3 audit/fix rounds), and confirmation that autopilot ends by opening a draft PR but never merges or deploys.
- **External dependencies** — anything only Sean can supply (keys, accounts, third-party access). If the run will block on one of these, that's a reason to resolve it now or narrow scope so it doesn't.

## Delegating the plan to a cheaper model

If the work isn't planned yet, don't burn the orchestrator's tier on it. Hand planning to a **Sonnet subagent** (`Agent`, model `sonnet`) — or the `Plan` agent — with the intent and scope, get back a step-by-step plan, then bring it to Sean for sign-off. The orchestrator's judgment goes into *reviewing* the plan, not drafting it. Escalate to a stronger model only if the cheap draft doesn't clear the bar.

This is the first place the routing principle shows up: cheap model does the legwork, the high-taste orchestrator judges the result.

## Ensure the backing artifact is in place

autopilot needs something concrete to build toward and to be checked against. That's two artifacts: the **spec** (below) and a **tracked issue**. Make sure the issue exists *before* you hand off — you're here and interactive, so this is the cheap moment to create it.

- **Use an existing issue** if the work already has one — take its reference.
- **Create one** if it doesn't. You're at the keyboard: confirm the one-liner with Sean, then file it.
- **Name the branch for the issue** so the trail is obvious end to end — autopilot builds on it, `open-pr` closes the issue from the PR.

Keep this **tracker-agnostic and portable** — don't compile a tracker into the skill:

- The portable default is a **GitHub issue** (`gh issue create`) with a branch like `{issue-number}-{slug}`. Works for anyone with a repo, zero setup.
- Which tracker to use, and the branch-name format, is a **project convention** declared in the project's own `CLAUDE.md` — e.g. "issues live in Linear; branches are `lin-{id}-{slug}`," in which case create/link the Linear issue via the Linear tools instead. Read and follow that convention when it's present.

Record the issue reference and the branch in the spec so autopilot and `open-pr` both pick them up.

## Write the spec, then hand off

Once the bar is met, write the settled spec to disk — this is the contract `autopilot` consumes, and it survives context compaction and ports cleanly into the harness later.

Location: `docs/autopilot/{YYYY-MM-DD}-{short-slug}.md` in the active project (today's date first, so the directory sorts chronologically).

```markdown
# {YYYY-MM-DD} — {Short title}

## Intent
{The outcome. One short paragraph.}

## Scope
- In: {…}
- Out: {…}

## Plan
{The concrete steps autopilot's developer should follow.}

## Done-signal
{Exactly how autopilot knows the work is complete.}

## Audit lenses
- simplicity
- security
{…and any others agreed this run.}

## Issue
{tracker ref + URL — e.g. #123 or LIN-1234}

## Branch
{branch-name, named for the issue}

## Guardrails
- Loop bound: {N} audit/fix rounds
- End by opening a draft PR; never merge or deploy.

## External dependencies
{Anything only Sean supplies, or "none".}
```

Then say the line out loud — "I have what I need; you can walk away. Starting autopilot on `{branch}`." — and invoke the `autopilot` skill with the spec path. Don't hand off until you'd bet the spec is right; a bad spec turns an unattended run into unattended damage.

## When NOT to use preflight

- **Work Sean will supervise anyway.** If he's staying at the keyboard, skip the ceremony and just do the work.
- **Heavy, open-ended design questions.** That's `grill-me` — run it first if the direction itself is unsettled, then preflight to package the result for execution.
- **Trivial changes.** A rename doesn't need a spec or a walk-away line.

## Related skills

- `autopilot` — the unattended build+audit run this hands off to.
- `grill-me` — deeper, doc-producing alignment when the direction (not just the execution) is in question. Preflight borrows its "could execute without me" bar.
- `paper-trail` — session log; useful if the preflight conversation itself produced decisions worth recording.
