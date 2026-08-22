# Output Styles

Claude Code output styles that ship with this repo. An output style replaces the
default response-shape instructions in Claude's system prompt, so it applies to
every turn of every session rather than decaying the way a one-time instruction
does.

## Concise

`concise.md` — lead with the answer, teach in passing, then stop and let me pry.

It exists because "be brief" alone does not hold. The style is written as
checkable rules instead of negative ones, so when a response drifts you can name
the line that broke rather than concluding the whole thing failed.

What it asks for:

- **A one-clause why, then stop.** Every claim carries its own reason in plain
  words; the reason behind the reason waits until you ask.
- **Bold-lead paragraphs of two or three sentences.** Reads as fast as bullets
  but keeps the connective tissue between points.
- **No assumed knowledge of the code.** Every identifier gets a plain-language
  gloss inline the first time it appears, in the sentence that uses it.
- **Plain words over correct ones.** If a precise term is not doing work you can
  use today, it is left out — not defined.

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

## Notes

- **Output styles load at session start.** Editing the file mid-session changes
  nothing until you open a new one.
- **The `name:` in the frontmatter is the identifier** `settings.json` points
  at, not the filename. Renaming the file is fine; renaming `name:` means
  updating `outputStyle` to match.
- `/output-style` lists what is installed and switches between them in-session.
