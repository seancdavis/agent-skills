---
name: update-voice
description: Build or refresh the personal writing-voice profile that `human-readable` applies. Invoke with `/update-voice` — first run researches the author's actual published writing (blog posts, docs, newsletters they point to) and distills a profile; later runs update the existing profile with new evidence or corrections. Only the user invokes this.
disable-model-invocation: true
---

# Update Voice — distill how the author actually writes

Produce one file that captures a specific human's voice well enough that a model applying it stops sounding like a model. The output feeds `human-readable`; this skill is only about building and maintaining it.

## Where the profile lives

- `~/.claude/writing-voice.md` — user-level, follows the author everywhere. **Default.**
- `docs/writing-voice.md` — project-level, for a shared project or team voice.

Ask once which one this session is building (default to user-level if they shrug). If the target file already exists, you're in **update mode** — skip to the bottom.

## First run: build the profile

### 1. Collect writing the human actually wrote

Ask where their writing lives — a blog, docs they hand-wrote, newsletters, talk abstracts, social threads, long emails they're proud of. Then gather 5–10 pieces yourself (WebFetch for published pieces, Read for local ones): varied in type, weighted toward recent, and including at least one piece they'd call their best.

**The authorship guardrail:** confirm which pieces they wrote themselves. AI-drafted or heavily AI-assisted pieces are poison here — distilling a profile from a model's writing just re-encodes the tells the profile exists to remove. When in doubt about a piece, ask; when still in doubt, drop it.

### 2. Distill with evidence

Read the corpus looking for what this author _does_, not what they're like. Adjectives ("conversational, clear, friendly") describe every blogger alive and constrain nothing — a profile made of them produces the same slop as no profile. What works is contrastive and quotable:

- **Named tics, each anchored to a real quoted line.** "Opens mid-thought, like resuming a conversation — 'So here's the thing about build tooling...'" beats "casual openers."
- **Negative space.** What never appears in the corpus — constructions, words, formats the author demonstrably avoids — is as defining as what does.
- **Before/after pairs.** Take a sentence a model would write on one of their topics and rewrite it the way the corpus says they would. Two or three of these teach voice faster than a page of description.

### 3. Draft the profile

Use this shape (sections can flex to fit the author, but keep evidence attached to every claim):

```markdown
# Writing voice — {name}

_Last updated {date} · distilled from: {sources, with rough date range}_

## How I sound

- {observation}. — "{quoted line}" ({source})
- ...

## Moves

- **Openers:** {how pieces start, with a quote}
- **Transitions:** {how they move between ideas}
- **Endings:** {how pieces stop}

## Punctuation & formatting

{em-dash and fragment habits, contractions, list and header appetite,
emoji, capitalization — the mechanical fingerprint}

## Vocabulary

- **Reach for:** {characteristic words and phrases}
- **Never:** {words and constructions absent from the corpus}

## Before / after

- AI default: "{generic sentence}"
  Me: "{the same idea, their way}"

## Per medium

- **Blog:** ...
- **Docs:** ...
- **Social:** ...
```

### 4. Red-pen review

Show the draft and let the author mark it up — this is the step that makes the profile theirs rather than your read of them. Corrections here are the highest-value content in the file; work them in verbatim where possible.

### 5. Write it, then calibrate

Write the file to the agreed location. Then run one calibration: take a deliberately generic AI paragraph on a topic they'd write about, rewrite it through the new profile, and ask "does this sound like you?" One round of adjustment from that answer usually settles the profile.

## Update mode

The profile is a living file, not an append log. When it already exists:

1. Read it and ask what prompted the update — new published writing, drift ("it doesn't sound like me anymore"), or a specific correction from using `human-readable`.
2. Fold the new evidence in: revise the tics it changes, keep what still holds, and delete claims the author now disowns.
3. Refresh the "last updated" line and source list.

Corrections from real use ("I'd never say 'folks'") go straight into **Never** or the relevant tic — those observations are worth more than another round of corpus research.
