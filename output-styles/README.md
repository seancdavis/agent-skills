# Output Styles

Claude Code output styles that ship with this repo. An output style replaces the
default response-shape instructions in Claude's system prompt, so it applies to
every turn of every session rather than decaying the way a one-time instruction
does.

## Concise

`concise.md` — answer in under 150 words, teach in passing, then stop and let me
pry.

It exists because "be brief" alone does not hold. The rules are checkable rather
than negative, so when a response drifts you can name the line that broke.

What it asks for:

- **A hard budget: 150 words.** The gist should land in 10–15 seconds. Most
  answers are one to three sentences.
- **Only the question asked.** Not the related questions, not what turned up
  along the way, not the caveats.
- **A one-clause why, then stop.** The reason behind the reason waits until you
  ask for it.
- **No assumed knowledge of the code.** Every identifier gets a plain-language
  gloss inline the first time it appears, in the sentence that uses it.
- **Prose by default.** Bold-lead paragraphs are reserved for options or
  comparisons you asked for — using them everywhere is what makes answers grow.

An earlier version capped paragraph length but not total length, and made
bold-lead paragraphs the house style. Both changes pushed answers longer: every
response became a list of parallel points, and each point justified itself.

## Install

```bash
./output-styles/install.sh
```

Copies the style to `~/.claude/output-styles/` and sets `"outputStyle":
"Concise"` in `~/.claude/settings.json`, backing up the original first. Safe to
re-run.

Standalone, without a checkout:

```bash
curl -fsSL https://raw.githubusercontent.com/seancdavis/agent-skills/main/output-styles/install.sh | bash
```

Then install [`hooks/concise-reminder.sh`](../hooks/README.md) too. The style
alone drifts over a long session, because it is loaded once at startup and slides
away from the current turn; the hook re-injects a short version of the rules on
every prompt.

## Notes

- **Output styles load at session start.** Editing the file mid-session changes
  nothing until you open a new one.
- **The `name:` in the frontmatter is the identifier** `settings.json` points
  at, not the filename. Renaming the file is fine; renaming `name:` means
  updating `outputStyle` to match.
- `/output-style` lists what is installed and switches between them in-session.
