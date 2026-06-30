---
name: clip
description: Copy conversation output to the system clipboard as raw Markdown. Invoke when the user types `/clip` (optionally followed by a description of what to copy) or asks to "copy that to my clipboard", "put that on my clipboard", "copy the answer/table/code as markdown", or "pbcopy this" — i.e. they want the Markdown source of something in this conversation (the last response by default, or a part they name) placed on the OS clipboard so it pastes cleanly into a doc, issue, or note. NOT for copying files between locations (that is `cp`).
---

# Clip

Put the **raw Markdown source** of conversation output onto the system clipboard. The terminal renders Markdown styled, which doesn't paste cleanly elsewhere — this copies the underlying source so it lands as clean Markdown in docs, issues, Slack, or notes.

## What to copy

Any text after `/clip` is a **natural-language description of what to copy** — treat it as the target selector, not a count or an index. `/clip the SQL query` means copy the SQL query; `/clip your last two messages` means copy those two messages; `/clip just the bash function` means copy that function. A bare number is a description too, never a quantity: `/clip 2` means "the thing labeled 2" (a list item, a step, a code block #2) — if there's no such thing, ask rather than copying the last 2 of anything.

- **No argument:** copy the most recent substantial thing you produced — the last answer, artifact, or deliverable.
- **Argument present:** copy exactly what it describes. Resolve it against the conversation; the argument tells you _which_ content, not _how much_.
- **Genuinely ambiguous** (the description matches several candidates, or matches nothing): ask one quick question instead of guessing.

Copy the Markdown _source_ — headings as `#`, lists as `-`, code in fenced blocks — not a re-rendered or re-summarized version. Don't add a preamble or commentary; copy the content itself.

## How to copy

Two steps: write a temp file, then one command to copy it. Writing the Markdown to a file (instead of `echo` or a heredoc) avoids shell-escaping problems with backticks, quotes, and newlines.

1. Write the exact Markdown to a temp file with the Write tool.
2. Copy it with a single command — on macOS:

   ```sh
   pbcopy < /path/to/tempfile.md
   ```

   Not on macOS? Read from the same file with the platform's tool instead: `wl-copy < file`, `xclip -selection clipboard < file`, `xsel --clipboard --input < file`, or `clip.exe < file`.

3. Confirm in one line, e.g. `Copied to clipboard — 42 lines of Markdown.`

Keep the command to that single `pbcopy < file` line — no tool-detection cascade, no `wc`/`rm` afterthoughts. A clean one-liner is allowlistable (so it stops prompting) and easy to read. The temp file lives in the session scratchpad and is cleaned up automatically; no need to delete it.

## When it can't

- **No clipboard tool** (headless, SSH, container): say so and offer to write the Markdown to a file instead.
- **Nothing to copy yet:** ask what they'd like copied.

Keep the confirmation short. This is a utility, not a conversation.
