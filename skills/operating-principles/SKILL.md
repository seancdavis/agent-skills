---
name: operating-principles
description: Living single-source-of-truth doc that reflects the project's current architecture, conventions, and principles. Always describes "now" — no conflicts, no historical alternatives, no superseded patterns. Use when an architectural choice changes and the doc needs to catch up, when a new pattern is adopted, or when onboarding to a project (read this first). ADRs in `decision-log` hold the why; this doc holds the what-is. Session logs in `paper-trail` reference this doc when they update it.
---

# Operating Principles

For frozen historical decisions, see `decision-log`. For per-session logs, see `paper-trail`. This skill covers the living current-state doc.

---

## What it is

A single file — `docs/principles.md` — that always reflects how the project actually works **right now**. No "we used to do X" sections. No "option A vs option B" comparisons. If something changes, the doc changes.

The audience is anyone (Sean, a future Claude session, a collaborator) walking in cold and needing to know: how is this project structured, what conventions does it follow, what's the philosophy.

The ADRs explain *why* the project got here. This doc explains *what is true here*.

---

## Location

```
project/
└── docs/
    └── principles.md
```

One file, not a directory. If it grows past ~300 lines, that's a smell: split into linked sub-files only when sections actually need depth that doesn't fit.

---

## What goes in it

- **Architecture** — the shape of the codebase. Tech stack, where things live, how requests flow.
- **Conventions** — naming, organization, formatting rules that aren't enforced by tooling.
- **Principles** — opinions the project takes. "Prefer server-rendered pages over SPAs." "Every user-scoped query filters by userId."
- **Boundaries** — what this project does and explicitly does not do.

## What does NOT go in it

- Why a decision was made. (That's the ADR.)
- Historical context. ("Originally we used X, then switched to Y.") The doc is "now."
- Implementation details a fresh reader could see by reading the code.
- Anything that changes per-session or per-feature.

---

## Format

```markdown
# Operating Principles — {Project Name}

Last updated: {YYYY-MM-DD}

## Architecture

{Tech stack and shape of the codebase. 1–3 paragraphs or a bulleted overview.}

## Conventions

### {Convention area, e.g., "Routing"}

{Rule, stated as a rule. "Routes live in `src/pages/`. CRUD endpoints follow Rails-style URLs."}

### {Convention area, e.g., "Forms"}

{Rule.}

## Principles

- {Principle stated as a rule, terse.}
- {Principle.}

## What this project does NOT do

- {Explicit non-goal.}
- {Explicit non-goal.}

## Pointers

- Decisions and rationale: `docs/decisions/`
- Session logs: `docs/sessions/`
- Skills referenced by this project: {list}
```

The structure is a starting shape, not a rigid spec. Sections that don't apply get dropped. New sections get added when the project develops a kind of rule that doesn't fit existing buckets.

---

## How it gets updated

Updates happen at the **end of a grill session** when "now" shifted — or any time a real change to current state lands.

The update pattern is **replace**, not append:

- If the project used to render pages server-side and now renders client-side, the doc says "renders client-side." It does not say "renders client-side (previously server-side)."
- If a convention is dropped, the line is deleted, not crossed out.
- Bump the `Last updated:` date when anything changes.

The history of *how* it changed lives in git + ADRs + session logs. The doc itself is always current.

---

## When to update

Update when:

- An ADR is filed that changes a project-wide rule. (The ADR explains why; the principles doc reflects the new rule.)
- A new convention is adopted. (Naming pattern, organizational rule, anything other code will need to follow.)
- An old convention is dropped. (Delete the line.)
- The shape of the codebase changes materially. (New top-level concept, removed system.)

Don't update for:

- Individual feature work that doesn't establish a pattern.
- Bug fixes.
- One-off exceptions ("we did it this way for this one endpoint"). One-offs go in code comments.

---

## When to create it

- **At project start** — even one line of "this project uses Astro on Netlify" beats nothing. Grow it from there.
- **At project onboarding** — if joining an existing project that doesn't have one, create it from what the code actually shows + ask Sean to fill in the principles he hasn't written down.

---

## Anti-patterns

- **Letting it go stale.** A `principles.md` that disagrees with the code is worse than no file. If you notice drift during normal work, fix it.
- **Stuffing rationale in.** This is the "what," not the "why." Link to ADRs for the why.
- **Long preambles.** Get to the rules. The reader wants to know what to do, not be persuaded.
- **Treating it as immutable.** It is the opposite of immutable. ADRs are frozen; this doc moves.

---

## Related skills

- `grill-me` — surfaces "now" changes during sessions, updates this doc at end
- `decision-log` — ADRs explain why each rule in this doc exists
- `paper-trail` — session logs note when this doc was updated
