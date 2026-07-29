#!/usr/bin/env bash
#
# Installs the concise-reminder UserPromptSubmit hook.
#
# What it does (each step is idempotent — safe to re-run):
#   1. Ensures `jq` is available (JSON editing).
#   2. Copies concise-reminder.sh to ~/.claude/hooks/ and makes it executable.
#   3. Wires a UserPromptSubmit entry into ~/.claude/settings.json (backing up
#      the original), skipping if the hook is already registered.
#
# Usage:
#   ./hooks/install.sh                                   # from a checkout of this repo
#   curl -fsSL <raw-url>/hooks/install.sh | bash         # standalone

set -euo pipefail

CLAUDE_DIR="$HOME/.claude"
SETTINGS="$CLAUDE_DIR/settings.json"
DEST_SCRIPT="$CLAUDE_DIR/hooks/concise-reminder.sh"
HOOK_CMD="~/.claude/hooks/concise-reminder.sh"
# Raw location used only when running standalone (script not found locally).
RAW_BASE="https://raw.githubusercontent.com/seancdavis/agent-skills/main/hooks"

bold=$(tput bold 2>/dev/null || true)
green=$(tput setaf 2 2>/dev/null || true)
red=$(tput setaf 1 2>/dev/null || true)
reset=$(tput sgr0 2>/dev/null || true)

step() { printf '%s==>%s %s\n' "$bold$green" "$reset" "$1"; }
info() { printf '    %s\n' "$1"; }
die()  { printf '%sX  %s%s\n' "$red" "$1" "$reset" >&2; exit 1; }

# ── 1. jq ────────────────────────────────────────────────────────────────
step "Checking jq"
command -v jq >/dev/null 2>&1 || die "jq is required. Install it (e.g. 'brew install jq') and re-run."
info "found: $(jq --version)"

# ── 2. Install the script ──────────────────────────────────────────────────
step "Installing hook script -> $DEST_SCRIPT"
mkdir -p "$CLAUDE_DIR/hooks"
SRC_SCRIPT=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "$(dirname "${BASH_SOURCE[0]}")/concise-reminder.sh" ]; then
  SRC_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/concise-reminder.sh"
fi
if [ -n "$SRC_SCRIPT" ]; then
  cp "$SRC_SCRIPT" "$DEST_SCRIPT"
  info "copied from $SRC_SCRIPT"
else
  info "downloading from $RAW_BASE/concise-reminder.sh"
  curl -fsSL "$RAW_BASE/concise-reminder.sh" -o "$DEST_SCRIPT"
fi
chmod +x "$DEST_SCRIPT"

# ── 3. Wire up settings.json ────────────────────────────────────────────────
step "Configuring $SETTINGS"
[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"

if ! jq empty "$SETTINGS" >/dev/null 2>&1; then
  die "$SETTINGS is not valid JSON. Fix or remove it, then re-run."
fi

if jq -e --arg cmd "$HOOK_CMD" \
  '[.hooks.UserPromptSubmit // [] | .[] | .hooks[]? | .command] | any(. == $cmd)' \
  "$SETTINGS" >/dev/null; then
  info "hook already registered — nothing to do"
else
  backup="$SETTINGS.bak.$(date +%Y%m%d%H%M%S)"
  cp "$SETTINGS" "$backup"
  info "backed up to $backup"
  tmp=$(mktemp)
  jq --arg cmd "$HOOK_CMD" \
    '.hooks.UserPromptSubmit = (.hooks.UserPromptSubmit // []) + [{hooks: [{type: "command", command: $cmd}]}]' \
    "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
  info "added UserPromptSubmit -> $HOOK_CMD"
fi

printf '\n%sConcise-reminder hook installed.%s\n' "$bold$green" "$reset"
printf 'It takes effect on the next prompt in any session (open /hooks or restart if not).\n\n'
