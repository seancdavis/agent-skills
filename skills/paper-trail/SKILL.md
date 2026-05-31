---
name: paper-trail
description: Session log format. One file per grill-me session, capturing the outcome of that session — what Sean and Claude landed on, not the back-and-forth that got them there. Use when ending a `/grill-me` session, or any other time a substantive design conversation reaches a conclusion that should outlive the chat. ADR-style decisions go in `decision-log`; current-state architecture goes in `operating-principles`. This skill is only for the session log.
---

# Paper Trail — Session Log

For ADR-formatted decision records, see `decision-log`. For the living current-state doc, see `operating-principles`. This skill covers the per-session log only.

---

## What a session log is

A snapshot of where a single grill (or any substantial design conversation) ended up. Sean has limited time; he can't re-read transcripts. The session log is the "if you only read one file, this is what we landed on" artifact.

It captures the **outcome**:

- What was discussed in broad strokes.
- What got decided (with links to the ADRs that hold the why).
- What's still open and needs further work.
- What's been added to / changed in `operating-principles`.

It does **not** capture:

- The back-and-forth that got there.
- Tangents that were raised and resolved.
- Options considered but not chosen (that belongs in an ADR if a decision was made, otherwise it's just noise).
- Conflicting opinions that were aligned during the session.

The bar: a reader who wasn't there should understand what to do next, and could pull the ADRs for the why.

---

## Location

```
project/
└── docs/
    └── sessions/
        ├── 2026-05-22-grill-project-kickoff.md
        ├── 2026-05-29-grill-auth-rewrite.md
        └── 2026-06-03-grill-image-pipeline.md
```

Filename: `YYYY-MM-DD-{short-slug}.md`. Date first so the directory sorts chronologically.

---

## Format

```markdown
# {YYYY-MM-DD} — {Short title}

## Topic

{One paragraph: what this session was about and why it happened.}

## Outcome

{2–5 bullets: what was landed on. Concrete, not vague. "Use Netlify Identity with the invite-only registration setting" beats "decided on auth approach."}

## Decisions filed

- [ADR-0007 — {Title}](../decisions/0007-{slug}.md)
- [ADR-0008 — {Title}](../decisions/0008-{slug}.md)

(Omit this section if no ADRs were filed.)

## Operating principles updated

- {Section that changed in `docs/principles.md`} — {one-line summary of the change}

(Omit if `principles.md` didn't change.)

## Still open

- {Open question that didn't get resolved this session}
- {Decision deliberately deferred until X is known}

(Omit if nothing is open.)

## Next steps

- {Concrete action, with owner if not Sean}
- {Concrete action}
```

Sections that don't apply get omitted. Don't write "N/A" placeholders.

---

## Writing rules

- **Past tense, indicative.** "Decided to use X" not "We should use X."
- **Link, don't restate.** Decisions live in ADRs; principles live in `principles.md`. The session log points at them; it doesn't duplicate them.
- **No transcript.** If you're tempted to write "Sean said... and then I said...", stop.
- **One page max.** If the log is longer than a screen, something belongs in an ADR instead.

---

## When to write one

- End of every `/grill-me` session — always, even short ones.
- End of any other design conversation that produced something worth remembering. Sean's call.

If a session resolved nothing concrete (rare — usually means the grill needs to continue), still write one short entry noting "no decisions reached, see Still open."

---

## Anti-patterns

- **Surfacing resolved conflicts.** If during the session Sean and Claude considered three approaches and picked one, the rejected approaches don't go in the log. They might go in the chosen approach's ADR ("Options considered"), but the session log just records what was chosen.
- **Padding with context already in ADRs.** The log links; the ADR is the source.
- **Skipping the "Still open" section.** Open questions are the most useful part for the next session.

---

## Related skills

- `grill-me` — produces session logs at the end of every grill
- `decision-log` — ADRs linked from session logs
- `operating-principles` — living doc that session logs reference when "now" shifts
