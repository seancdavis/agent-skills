---
name: grill-me
description: Pre-execution alignment session. Sean types `/grill-me` when he wants Claude to interview him until the upcoming work is understood well enough that Claude could execute it without further intervention (aside from external connections and keys Sean has to provide). Free-form conversation, not a canned questionnaire. At session end, hands off to `paper-trail` (always), `decision-log` (zero or more ADRs), and `operating-principles` (when current state shifted).
disable-model-invocation: true
---

# Grill Me

## Goal

Reach the point where you (Claude) could go off and implement the work alone, with **99% confidence**, and only Sean's external-world contributions (API keys, third-party account access, credentials, hardware) would still be needed.

Push toward that confidence level. Don't stop at "I think I get it." If anything Sean said could be interpreted two ways, surface it.

## How it goes

It's a free-form conversation, not a script. Sean talks; you listen, restate, and ask pointed follow-ups. The shape varies — sometimes it's a project kickoff, sometimes a single feature, sometimes an irreversible change Sean wants to think through out loud. Don't force a template on it.

What you're trying to nail down:

- **Intent** — what is the actual outcome Sean wants? (Not "build X," but "after this, Sean's situation is Y.")
- **Scope** — what's in, what's out. Where are the edges?
- **Constraints** — anything fixed (existing schema, deploy target, third-party SLA, budget for tokens, etc.)?
- **Decisions already made** — what's locked in vs. genuinely open? Skip re-litigating locked items.
- **Open decisions** — every "I don't know yet" is a candidate for an ADR. Surface them.
- **Dependencies and unknowns** — what external things does Sean own? (Keys, accounts, DNS, hardware.) What does *neither* of you know yet?
- **Edge cases** — what happens when the input is empty? When the third-party times out? When two users do this at once?
- **Success signal** — how will Sean know it worked? What does verification look like?

## When to push back

If Sean says something hand-wavy ("we'll figure that out"), ask which way he's leaning so the call can be made now. If the call genuinely can't be made yet, say so explicitly and note it as an open question — that's an honest "no" rather than a fake "yes."

If two things Sean said are in tension, surface the conflict. Don't paper over it.

## When to stop

Stop when **you could write a detailed PR description right now** for the work that's coming next — title, summary bullets, test plan — and you'd be confident every bullet is right. If you can't, you're not done.

## End-of-session handoff

At the end, do three things in order:

1. **Always** write a `paper-trail` entry (see the `paper-trail` skill). One file in `docs/sessions/`. Captures the outcome — not the back-and-forth. Skip resolved tangents.

2. **For each actual decision made**, write an ADR (see the `decision-log` skill). Zero is a valid count. Don't manufacture ADRs to look productive — only real, would-be-questioned-later decisions.

3. **If the project's current state shifted** (new architectural pattern adopted, principle changed, convention introduced), update `docs/principles.md` (see the `operating-principles` skill). The operating principles always reflect "now" — no conflicts in that doc.

Tell Sean what you're about to write before writing it: "I'm going to log this session, file two ADRs (X and Y), and update the principles doc to reflect Z. Sound right?" — let him correct course before files land.

## What grill-me is not

- It is **not** a structured questionnaire. No fixed question list.
- It is **not** for trivial tasks. If Sean asks for "rename this variable," he didn't need to grill — just do it.
- It is **not** triggered by you. Wait for `/grill-me`. Don't suggest "want me to grill you about this?" — Sean reaches for it when he wants it.
- It does **not** write artifacts itself. The three artifact skills own their formats and locations; you orchestrate the call.

## Related skills

- `paper-trail` — session log format and location
- `decision-log` — ADR format and location
- `operating-principles` — living current-state doc, format and location
