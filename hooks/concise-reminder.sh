#!/bin/bash
# UserPromptSubmit hook: re-inject a few rules from the Concise output style
# (output-styles/concise.md) at the recency end of context on every prompt.
#
# The harness already re-injects a pointer to the active output style each turn
# ("Concise output style is active"). In practice a pointer is not enough over a
# long session: the style itself was loaded at startup and keeps sliding away
# from the current turn. This injects rule *text* at max recency instead.
#
# If you edit the text below, keep it a strict subset of the output style —
# every sentence must already appear there, verbatim in substance. This runs at
# max recency, so a paraphrase that drifts will win over the style itself.

cat <<'EOF'
{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"Check the reply you are about to write against the active Concise output style; this is a subset of that file, not a replacement. Stay under 150 words unless asked for more — the gist should land in 10-15 seconds. Answer only the question asked, not the related ones and not what you found on the way. One clause of why, then stop. Prose by default; use bold-lead paragraphs only for options or a comparison that was asked for, since using them everywhere is what makes answers grow. Gloss every identifier inline; assume the file has not been read. No aphorisms or clever phrasing; never write 'simply', 'just', 'obviously', or 'as you know'. Stop when the answer stops — no summary, no offer of more work."}}
EOF
