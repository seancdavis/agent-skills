---
name: decision-log
description: Architecture Decision Record (ADR) format and conventions. One file per real decision — context, decision, consequences — frozen at the moment the decision was made. Use when documenting an architectural choice, recording trade-offs that informed a pick, or superseding an earlier decision. Session-level recaps go in `paper-trail`; current-state architecture goes in `operating-principles`. This skill is the ADR format only.
---

# Decision Log — ADRs

For session logs, see `paper-trail`. For the living current-state doc, see `operating-principles`. This skill covers the per-decision frozen record.

---

## Purpose

Git commits capture **what** changed. ADRs capture **why** a decision was made, what alternatives were considered, and what trade-offs Sean accepted.

ADRs are **frozen** once written. They are the historical record. Don't edit an old ADR to reflect a new decision — file a new ADR that supersedes it.

---

## When to file an ADR

- Major architectural choices (framework, database, hosting model).
- Technology selections with real trade-offs.
- Conventions established that aren't self-explanatory from the code.
- Decisions a future reader would reasonably question.
- Reversals — when an earlier decision is being replaced, supersede it with a new one.

## When NOT to file an ADR

- Obvious choices (TypeScript over JavaScript).
- Implementation details that don't affect architecture.
- Decisions already well-captured in a skill or in `operating-principles`.
- Temporary workarounds — put a code comment, not an ADR.

If you're unsure, err on the side of writing one short ADR rather than zero. Sparse decisions become invisible.

---

## Location

```
project/
└── docs/
    └── decisions/
        ├── 0001-use-astro-over-nextjs.md
        ├── 0002-timestamp-migrations.md
        └── 0003-approved-users-safelist.md
```

`docs/decisions/` — public, version-controlled, visible. Not `.claude/` — these are for humans too.

---

## Naming

```
{NNNN}-{short-kebab-description}.md
```

Sequential numbers within the project, four digits. Description short enough to read at a glance in a directory listing.

---

## ADR format

```markdown
# {NUMBER}. {TITLE}

Date: {YYYY-MM-DD}
Status: {proposed | accepted | deprecated | superseded by [ADR-XXXX]}

## Context

{What is the issue or question that motivated this decision?}
{What constraints or forces are at play?}
{What options were considered?}

## Decision

{What is the change or solution being made? Be specific and concrete.}

## Consequences

**Easier:**

- {benefit}
- {benefit}

**Harder:**

- {trade-off}
- {trade-off}

**Follow-up:**

- {action required, if any}
```

---

## Example — full ADR

```markdown
# 0001. Use Astro over Next.js

Date: 2024-01-15
Status: accepted

## Context

Starting a new Super Bowl party app. Users will view entries, vote, and check
a squares game. The vast majority of interactions are read-only displays.
Only a few forms for creating entries and casting votes.

Options considered:

- Next.js (App Router)
- Astro with React islands
- Vite + React SPA

## Decision

Use Astro with React components and server-side rendering.

Reasons:

- Most pages are content display (server rendering is ideal).
- Only 2–3 interactive components.
- Ships minimal JavaScript by default.
- Better performance for mobile users with spotty Super Bowl party WiFi.

## Consequences

**Easier:**

- SEO and performance are handled automatically.
- No client-side routing complexity for mostly-static pages.

**Harder:**

- Need to think about which components need `client:*` directives.
- Some SPA patterns don't apply.

**Follow-up:**

- Use React components (not Astro components) for anything that might
  eventually need interactivity.
```

---

## Example — lightweight ADR

For smaller decisions, drop the formal headers:

```markdown
# 0003. Approved Users Safelist Pattern

Date: 2024-01-16
Status: accepted

**Context:** Need auth but can't prevent Google OAuth signups at the provider
level.

**Decision:** Use an `approved_users` database table as safelist. Users who
sign in but aren't in the table see an "unauthorized" page.

**Rationale:** Simpler than restricting OAuth at the provider level. Adding
users is one row insert. Survives a provider switch.
```

The lightweight form is fine when the trade-offs really are minor. Don't use it as a way to avoid writing the Consequences section for a real decision.

---

## Status transitions

ADRs are immutable. To change a decision, file a **new** ADR and update the **old** one's Status field only:

```markdown
Status: superseded by [0007-switch-to-supabase.md]
```

Or, if the decision is no longer relevant but no successor exists:

```markdown
Status: deprecated

## Update ({YYYY-MM-DD})

This approach was abandoned because {reason}. No replacement; the system no
longer does this thing.
```

Don't delete old ADRs. They are the record of why things were done a certain way at the time, even after the way changes.

---

## Anti-patterns

- **Writing ADRs after the fact.** File at the moment of decision, when context is fresh. Backfilling ADRs months later produces revisionist summaries.
- **Too much detail.** Scannable beats exhaustive. Link to design docs if needed.
- **Missing Consequences section.** Trade-offs are the most valuable part of an ADR — the part future-Sean will actually want to read.
- **Editing instead of superseding.** ADRs are frozen. Update the Status line only.
- **Storing in `.claude/`.** These are project documentation, not Claude-private notes.

---

## Related skills

- `grill-me` — produces ADRs as session output
- `paper-trail` — session logs link to the ADRs filed that session
- `operating-principles` — once a decision is in effect, its rule may belong in `principles.md` too
