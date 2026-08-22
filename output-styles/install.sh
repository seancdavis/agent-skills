#!/usr/bin/env bash
#
# Installs the Concise output style.
#
# What it does (each step is idempotent — safe to re-run):
#   1. Ensures `jq` is available (JSON editing).
#   2. Copies concise.md to ~/.claude/output-styles/.
#   3. Sets "outputStyle": "Concise" in ~/.claude/settings.json (backing up
#      the original), skipping if it is already selected.
#
# Usage:
#   ./output-styles/install.sh                            # from a checkout of this repo
#   curl -fsSL <raw-url>/output-styles/install.sh | bash  # standalone

set -euo pipefail

CLAUDE_DIR="$HOME/.claude"
SETTINGS="$CLAUDE_DIR/settings.json"
DEST_STYLE="$CLAUDE_DIR/output-styles/concise.md"
STYLE_NAME="Concise"
# Raw location used only when running standalone (file not found locally).
RAW_BASE="https://raw.githubusercontent.com/seancdavis/agent-skills/main/output-styles"

bold=$(tput bold 2>/dev/null || true)
green=$(tput setaf 2 2>/dev/null || true)
red=$(tput setaf 1 2>/dev/null || true)
reset=$(tput sgr0 2>/dev/null || true)

step() { printf '%s==>%s %s\n' "$bold$green" "$reset" "$1"; }
info() { printf '    %s\n' "$1"; }
die()  { printf '%sX  %s%s\n' "$red" "$1" "$reset" >&2; exit 1; }

# ── 1. jq ────────────────────────────────────────────────────────────────────
step "Checking jq"
command -v jq >/dev/null 2>&1 || die "jq is required. Install it (e.g. 'brew install jq') and re-run."
info "found: $(jq --version)"

# ── 2. Install the style file ────────────────────────────────────────────────
step "Installing style -> $DEST_STYLE"
mkdir -p "$CLAUDE_DIR/output-styles"
SRC_STYLE=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "$(dirname "${BASH_SOURCE[0]}")/concise.md" ]; then
  SRC_STYLE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/concise.md"
fi
if [ -n "$SRC_STYLE" ]; then
  cp "$SRC_STYLE" "$DEST_STYLE"
  info "copied from $SRC_STYLE"
else
  info "downloading from $RAW_BASE/concise.md"
  curl -fsSL "$RAW_BASE/concise.md" -o "$DEST_STYLE"
fi

# ── 3. Select it in settings.json ────────────────────────────────────────────
step "Configuring $SETTINGS"
[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"

if ! jq empty "$SETTINGS" >/dev/null 2>&1; then
  die "$SETTINGS is not valid JSON. Fix or remove it, then re-run."
fi

if jq -e --arg name "$STYLE_NAME" '.outputStyle == $name' "$SETTINGS" >/dev/null; then
  info "already selected — nothing to do"
else
  backup="$SETTINGS.bak.$(date +%Y%m%d%H%M%S)"
  cp "$SETTINGS" "$backup"
  info "backed up to $backup"
  tmp=$(mktemp)
  jq --arg name "$STYLE_NAME" '.outputStyle = $name' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
  info "set outputStyle -> $STYLE_NAME"
fi

printf '\n%sConcise output style installed.%s\n' "$bold$green" "$reset"
printf 'Output styles load at session start — open a new session to pick it up.\n\n'
