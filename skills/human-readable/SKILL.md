---
name: human-readable
description: Writing mode for prose that humans will actually read — blog posts, announcements, docs pages, newsletters, README copy, talk abstracts, social posts. Applies the author's personal voice profile (built by `update-voice`) plus rules that strip the tells of AI-generated writing. Invoke with `/human-readable` (optionally naming what to write or rewrite), or when the user says "make this sound like me," "humanize this," "this is going public," or is drafting content explicitly destined for an outside audience. Once invoked, stays on for prose deliverables for the rest of the session. NOT for code, commit messages, or conversational replies; PR bodies have their own convention in `open-pr`.
---

# Human Readable — write like a person, for people

Prose that leaves this session and lands in front of real readers. The job is two-fold: strip the tells that make writing read as generated, and apply the author's actual voice so it reads as _theirs_. Once invoked, this mode applies to every prose deliverable in the session until the user says otherwise.

## First: load the voice profile

Look for a profile in this order and read the first one found:

1. `docs/writing-voice.md` — project-level (a shared project or team voice)
2. `~/.claude/writing-voice.md` — user-level (the author's personal voice)

**The profile outranks everything below.** The rules in this file are the floor — they describe generic AI tells, and the profile describes a specific human. If the profile shows the author loves em-dashes, sentence fragments, or the rule of three, those aren't tells anymore; they're the voice. Apply the floor only where the profile is silent.

No profile found? Proceed with the floor alone, in plain first person, and mention once that `/update-voice` builds a personal profile — then drop it.

## The floor: strip the tells

The master tell is **ceremony and uniformity** — writing that performs the shape of an essay instead of saying something, in paragraphs of identical length and rhythm. No single construction is the problem; the pattern is. Read your draft asking "would a person busy enough to have something to say bother writing this sentence?" and cut everything that fails.

### Openers and endings

- Start with a claim, a fact, or a moment — something the reader didn't have before clicking. Never with a restatement of the topic, a definition of a term the reader obviously knows, or scene-setting ("In today's fast-paced world of...").
- Don't announce the structure ("In this post, we'll cover..."). Just cover it.
- End when the substance ends. No conclusion that restates, no "In conclusion," no closing benediction ("Happy coding!") unless the profile does that.

### Structure

- **Prose is the default.** Headers exist for navigation in long pieces, not one per thought. Bullets exist for genuinely enumerable things — steps, options, a list of names — not for delivering an argument.
- A list of full sentences with **bolded lead-ins** is a paragraph wearing a costume. Write the paragraph.
- Let paragraph length vary. Three one-sentence paragraphs in a row, then a long one — that's how people write when they mean it.

### Sentences

- Vary the rhythm. Generated prose settles into medium-length sentence after medium-length sentence; human writing has short punches and long rambles.
- Retire the stock constructions: "It's not just X — it's Y." "This isn't about X; it's about Y." Rhetorical questions as transitions ("So what does this mean for your team?"). "Whether you're a solo dev or an enterprise team..." Triads used for rhythm rather than because there are actually three things.
- Cut hedge stacks ("it's worth noting that," "arguably," "importantly") and empty intensifiers ("incredibly," "truly"). Say the thing or don't.

### Words

Certain words are load-bearing in generated text and nearly absent from human drafts: _delve, leverage, robust, seamless, comprehensive, crucial, landscape, journey, unlock, elevate, empower, supercharge, game-changer, utilize_. The rule isn't a blacklist — it's that abstract intensity is a substitute for specifics. When tempted to call something "powerful," describe what it does instead.

### Substance

- Every claim earns its space with something concrete: a number, a name, an example, a consequence. A sentence that would survive in any article on the topic belongs in none of them.
- State opinions as opinions, with a reason, in first person where the profile allows. "I'd pick X because Y" beats a both-sides survey the reader has to decode.
- Write for one reader, not an audience. If a sentence exists to cover a reader segment rather than to say something, cut it.

## Drafting vs. rewriting

**Drafting** something new: apply the profile from the first line — its openers, its moves, its vocabulary. Don't draft generic and humanize after.

**Rewriting** existing text ("humanize this"): keep the substance and any structural decisions that are sound; strip the tells; re-voice it. Deliver the rewrite itself, not a commentary on what changed — at most one line noting the biggest structural move.

Either way, do a final read-aloud pass: anywhere you stumble or hear a robot, rewrite that sentence.

## Per medium

- **Blog post** — the profile at full strength, including its opening and closing habits. Length follows substance, not a word-count instinct.
- **Docs / README** — voice dialed down, clarity up. Still no ceremony: no "This comprehensive guide will..."
- **Announcement / newsletter** — lead with what changed for the reader, not the org's journey to shipping it.
- **Social post** — the profile's social register if it has one; otherwise one idea, brutally short, no hashtag pile.

## Related skills

- `update-voice` — builds and refreshes the voice profile this mode applies.
- `open-pr` — PR bodies have their own leaner convention; don't apply this mode there.
