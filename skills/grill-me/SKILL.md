---
name: grill-me
description: Pre-execution alignment session. Sean types `/grill-me` when he wants Claude to interview him until the upcoming work is understood well enough that Claude could execute it without further intervention (aside from external connections and keys Sean has to provide). Free-form conversation, not a canned questionnaire. At session end, writes a one-page log of the outcome to `docs/sessions/`.
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
- **Open decisions** — surface every "I don't know yet": make the call now, or record it as still open.
- **Dependencies and unknowns** — what external things does Sean own? (Keys, accounts, DNS, hardware.) What does _neither_ of you know yet?
- **Edge cases** — what happens when the input is empty? When the third-party times out? When two users do this at once?
- **Success signal** — how will Sean know it worked? What does verification look like?

## When to push back

If Sean says something hand-wavy ("we'll figure that out"), ask which way he's leaning so the call can be made now. If the call genuinely can't be made yet, say so explicitly and note it as an open question — that's an honest "no" rather than a fake "yes."

If two things Sean said are in tension, surface the conflict. Don't paper over it.

## When to stop

Stop when **you could write a detailed PR description right now** for the work that's coming next — title, summary bullets, test plan — and you'd be confident every bullet is right. If you can't, you're not done.

## End-of-session log

**Always** write one file at the end, even for a short session: `docs/sessions/YYYY-MM-DD-{short-slug}.md`. Sean has limited time and can't re-read transcripts, so this is the "if you only read one file, this is what we landed on" record. A reader who wasn't there should know what to do next.

```markdown
# {YYYY-MM-DD} — {Short title}

## Topic

{One paragraph: what this session was about and why it happened.}

## Outcome

{2–5 bullets: what was landed on, concrete not vague, with the reason whenever the decision could be questioned later. "Use Netlify Identity with invite-only registration, because only known users need access" beats "decided on auth approach."}

## Still open

- {Open question, or decision deliberately deferred until X is known}

## Next steps

- {Concrete action, with owner if not Sean}
```

- Omit sections that don't apply; no "N/A" placeholders. If nothing was resolved, say "no decisions reached" and lean on Still open.
- Past tense. One page max.
- Capture the outcome, not the conversation: no back-and-forth, no resolved tangents, no rejected options.

Tell Sean what you're about to log before writing it, so he can correct course before the file lands.

## What grill-me is not

- It is **not** a structured questionnaire. No fixed question list.
- It is **not** for trivial tasks. If Sean asks for "rename this variable," he didn't need to grill — just do it.
- It is **not** triggered by you. Wait for `/grill-me`. Don't suggest "want me to grill you about this?" — Sean reaches for it when he wants it.

## Related skills

- `preflight` — packages the result into a spec for an unattended run, once the direction is settled.
