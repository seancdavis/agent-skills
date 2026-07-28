---
name: preflight
description: The front gate for an unattended build-and-audit run. Invoke with `/preflight` (optionally naming the work) when Sean wants to set up a piece of work thoroughly enough that he can walk away while it gets built and audited without him. Interactive alignment: pin intent, scope, a plan sliced into checkable increments, and an executable done-signal; ensure the work is backed by a tracked issue and a branch named for it; optionally hand planning to a cheaper model; write a settled spec to `docs/autopilot/`; then hand off to `autopilot`. This is the "you're here" half of the flow — `autopilot` is the "you're gone" half. NOT for work Sean intends to babysit step by step (just do that directly), and NOT the place for heavy open-ended design alignment (that's `grill-me`).
---

# Preflight — the front gate

Preflight is the human-present half of an unattended run. Sean is at the keyboard now; the point of this phase is to get the work understood well enough that he can leave and `autopilot` will build it, have Codex audit it, and leave a report — all without him. Everything preflight does is in service of one moment: saying **"I have what I need — you can walk away,"** and meaning it.

The orchestrator (this session) never writes the code and never audits it. Preflight's job is upstream of both: make the work legible enough to hand off.

## The bar

Drive to the same standard `grill-me` uses: **you could write the PR description right now** — title, summary, test plan — and be confident every line is right. Restated for this flow: _could `autopilot` run this to completion, unattended, without guessing?_ If any answer is "it would have to guess," you're not done. Guessing is cheap when Sean is sitting here to correct it and expensive when he's gone.

Don't stop at "I think I get it." If something Sean said has two readings, surface it now — this is the last cheap moment to.

## What you're pinning

Not a fixed questionnaire — a free-form conversation that lands these:

- **Intent** — the outcome, not the task. After this runs, Sean's situation is _Y_.
- **Scope** — what's in, what's explicitly out. Where autopilot should stop rather than wander.
- **The plan** — the concrete steps/approach. Solid enough that a developer subagent could follow it. For anything beyond a small change, land it as **ordered vertical slices**, each with its own check (see below). If it doesn't exist yet, see the delegation section below.
- **Done-signal** — how autopilot knows it's finished, written as checks it can **run**, not prose it can interpret (see below). Without this, an unattended run has no stop condition. If the work deletes or renames anything, derive it from the reference sweep below — not from a hand-picked file list.
- **Audit lenses** — default is **simplicity** and **security** (Codex, read-only, one pass each). Add or swap lenses if this work needs it; drop the design lens for now unless Sean asks.
- **Backing issue + branch** — the tracked issue this work answers to, and a branch named for it. If neither exists yet, this is where they get created (see below). autopilot builds on the branch; `open-pr` links/closes the issue.
- **Guardrails** — the loop bound (default: 3 audit/fix rounds), and confirmation that autopilot ends by opening a draft PR but never merges or deploys.
- **External dependencies** — anything only Sean can supply (keys, accounts, third-party access). If the run will block on one of these, that's a reason to resolve it now or narrow scope so it doesn't.

## Make the done-signal executable

Autopilot's completeness gate re-reads the spec and **runs** the done-signal before it's allowed to open the PR. That only works if every item is checkable by a command or an observation a machine can make: a test command that exits 0, an `rg`/`ast-grep` pattern with an expected hit count, a build that succeeds, a route that returns the right shape, a file that exists. "The dashboard feels faster" is not a done-signal; "`npm test` passes and `/api/stats` returns the aggregate shape named in the plan" is.

Why the strictness is worth it: models satisfice — the developer will declare done at the first defensible stopping point, and a prose done-signal gives the orchestrator no way to catch it. An executable one turns "is it done?" from judgment into measurement. This single property is what stops an unattended run from ending early with a clean-looking, 60%-complete branch.

Two escape valves so this doesn't become theater:

- An item only a human can judge (visual polish, UX feel) doesn't get faked into a hollow check — record it as `human-verify: …` under the done-signal. Autopilot copies those into the PR's verify note for Sean's smoke test instead of pretending to run them.
- Where the project has test conventions, prefer "the developer writes a test for X and it passes" over a bare grep — that check keeps guarding the behavior after the run is over.

## Slice the plan

For anything bigger than a small change, don't hand autopilot one monolithic plan. Land the plan as **ordered vertical slices** — each independently buildable, committable, and checkable, with its own check named right in the slice:

```markdown
## Plan

1. **{Slice title}** — {what to build}
   - Check: {command or observation that proves this slice landed}
2. …
```

Why slices instead of one big dispatch: a single context window holding the whole scope degrades as it fills — it ships the parts it remembers and declares victory. Autopilot dispatches a **fresh developer per slice** and runs each slice's check before advancing, so it cannot end early while the queue has unfinished items. This is also what makes bigger scope _safe_ to hand off: ambition lives in the spec, execution stays incremental.

Sizing guide: a slice is roughly one clean commit — buildable on its own, checkable on its own. If a slice can't state its own check, it isn't a slice yet; split it or sharpen it. Small work may legitimately be a single slice; the structure costs nothing.

## Program design and exemplars — for bigger specs

Intent, scope, and plan pin the _architecture_ altitude. The layer that's easiest to skip — and the one that most reduces developer wandering on a big spec — is **program design**: the actual types, method signatures, file layout, and (where it helps) the call graph. Ten extra minutes here shrinks the space the developer can guess in. Include it in the spec whenever the work touches more than a couple of files.

Also point at **exemplars**: one or two hand-picked idiomatic files in this repo that the new code should look like ("do it like `src/functions/notes.ts`"). Agents are pattern replicators — a concrete exemplar beats paragraphs of convention prose, and it's the cheapest line in the spec.

## Deletions and renames: sweep before you scope

When the plan **removes or renames** anything whose reach extends past the file you're editing — a file, directory, skill, exported identifier, config key, route — its blast radius doesn't respect your scope fence. You can descope _fixing_ a consumer; you can't descope _knowing_ it exists.

So build the scope and done-signal on a **repo-wide, unrestricted reference sweep**, never an assumed file list:

- Run it across the whole repo, **unrestricted by file type or directory** — `rg "<name>"` (respects `.gitignore`) or `grep -rn "<name>" .`. The trap is narrowing to `*.md`/`*.json` or to `skills/`; that exact narrowing is what leaks a `.ts` file in another directory.
- **Disposition every hit** in the spec: fix in scope / generated-rebuilds-itself / historical-leave / explicitly descoped **with the consequence named** ("descoping X means Y breaks"). Descoping without naming what breaks is how a real dependency gets waved past.
- The **done-signal derives from that sweep**, never from a subset of it. "grep `skills/` returns nothing" is a trap done-signal — it verifies your assumption, not the repo.

## Delegating the plan to a cheaper model

If the work isn't planned yet, don't burn the orchestrator's tier on it. Hand planning to a **Sonnet subagent** (`Agent`, model `sonnet`) — or the `Plan` agent — with the intent and scope, get back a step-by-step plan, then bring it to Sean for sign-off. The orchestrator's judgment goes into _reviewing_ the plan, not drafting it. Escalate to a stronger model only if the cheap draft doesn't clear the bar.

This is the first place the routing principle shows up: cheap model does the legwork, the high-taste orchestrator judges the result.

## Ensure the backing artifact is in place

autopilot needs something concrete to build toward and to be checked against. That's two artifacts: the **spec** (below) and a **tracked issue**. Make sure the issue exists _before_ you hand off — you're here and interactive, so this is the cheap moment to create it.

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

{Ordered vertical slices — each with its own check. Small work may be one slice.}

1. **{Slice}** — {what to build}
   - Check: {command or observation that proves it landed}

## Program design

{Types, signatures, file layout, call graph — for bigger specs. Omit for small ones.}

## Exemplars

{1–2 idiomatic files in this repo to imitate, and for what. Or "none".}

## Done-signal

{Every item a check autopilot can run: command + expected result.
Human-only judgments listed as "human-verify: …" — they route to the PR's verify note.}

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
- `autopilot-iterate` — picks the run back up after Sean reviews the draft PR; his review comments become the next control signal.
- `grill-me` — deeper, doc-producing alignment when the direction (not just the execution) is in question. Preflight borrows its "could execute without me" bar.
- `paper-trail` — session log; useful if the preflight conversation itself produced decisions worth recording.
