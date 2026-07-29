#!/bin/bash
# UserPromptSubmit hook: re-inject the core conciseness rules from
# ~/.claude/CLAUDE.md at the recency end of context on every prompt.
# Edit the text below to change the reminder.

cat <<'EOF'
{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"Reminder of standing response rules (from global CLAUDE.md): Lead with the answer or result — no preamble, no recap of the request, no narrating upcoming tool calls. One-line question gets a one-line answer. Status updates are a sentence or two, never a structured recap with headers. When in doubt, say less."}}
EOF
