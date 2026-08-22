#!/bin/bash
# UserPromptSubmit hook: re-inject a few rules from the Concise output style
# (output-styles/concise.md) at the recency end of context on every prompt.
#
# NOT installed by default — the harness already re-injects a pointer to the
# active output style each turn. This is the fallback for when that pointer
# stops being enough, and it injects rule *text* instead.
#
# If you edit the text below, keep it a strict subset of the output style —
# every sentence must already appear there, verbatim in substance. This runs at
# max recency, so a paraphrase that drifts will win over the style itself.

cat <<'EOF'
{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"Reminder — a subset of the active Concise output style, not a replacement for it: Lead with the answer or instruction, add one clause of why in plain words, then stop; the reason behind the reason waits until asked. Gloss every identifier inline the first time it appears — assume the file has not been read. Two or three sentences per paragraph, bolding the lead clause when the answer is a set of parallel points."}}
EOF
