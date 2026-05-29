#!/usr/bin/env bash
#
# Installs the custom Claude Code status line on a Mac.
#
# What it does (each step is idempotent — safe to re-run):
#   1. Ensures Homebrew is installed.
#   2. Ensures `jq` is available (JSON parsing).
#   3. Installs the JetBrainsMono Nerd Font cask (provides the glyphs).
#   4. Copies statusline.sh to ~/.claude/statusline.sh and makes it executable.
#   5. Wires `statusLine` into ~/.claude/settings.json (backing up the original).
#
# Usage:
#   ./statusline/install.sh                      # from a checkout of this repo
#   curl -fsSL <raw-url>/statusline/install.sh | bash   # standalone
#
# macOS only.

set -euo pipefail

# ── Config ───────────────────────────────────────────────────────────────
FONT_CASK="font-jetbrains-mono-nerd-font"
FONT_NAME="JetBrainsMono Nerd Font"
CLAUDE_DIR="$HOME/.claude"
SETTINGS="$CLAUDE_DIR/settings.json"
DEST_SCRIPT="$CLAUDE_DIR/statusline.sh"
# Raw location used only when running standalone (script not found locally).
RAW_BASE="https://raw.githubusercontent.com/seancdavis/claude-skills/main/statusline"

# ── Pretty output ──────────────────────────────────────────────────────────
bold=$(tput bold 2>/dev/null || true)
dim=$(tput dim 2>/dev/null || true)
green=$(tput setaf 2 2>/dev/null || true)
yellow=$(tput setaf 3 2>/dev/null || true)
red=$(tput setaf 1 2>/dev/null || true)
reset=$(tput sgr0 2>/dev/null || true)

step() { printf '%s==>%s %s\n' "$bold$green" "$reset" "$1"; }
info() { printf '    %s\n' "$1"; }
warn() { printf '%s!  %s%s\n' "$yellow" "$1" "$reset"; }
die()  { printf '%sX  %s%s\n' "$red" "$1" "$reset" >&2; exit 1; }

# ── Preflight ──────────────────────────────────────────────────────────────
[ "$(uname -s)" = "Darwin" ] || die "This installer supports macOS only."

# Locate statusline.sh: next to this script, else download it.
SRC_SCRIPT=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "$(dirname "${BASH_SOURCE[0]}")/statusline.sh" ]; then
  SRC_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/statusline.sh"
fi

# ── 1. Homebrew ──────────────────────────────────────────────────────────
step "Checking Homebrew"
if command -v brew >/dev/null 2>&1; then
  info "already installed: $(command -v brew)"
else
  info "installing Homebrew (you may be prompted for your password)..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Make brew available on Apple Silicon and Intel for the rest of this run.
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
  command -v brew >/dev/null 2>&1 || die "Homebrew install did not complete."
fi

# ── 2. jq ────────────────────────────────────────────────────────────────
step "Checking jq"
if command -v jq >/dev/null 2>&1; then
  info "already installed: $(jq --version)"
else
  info "installing jq..."
  brew install jq
  hash -r
fi

# ── 3. Nerd Font ───────────────────────────────────────────────────────────
step "Checking $FONT_NAME"
if brew list --cask "$FONT_CASK" >/dev/null 2>&1; then
  info "already installed: $FONT_CASK"
else
  info "installing $FONT_CASK..."
  brew install --cask "$FONT_CASK"
fi

# ── 4. Install the script ──────────────────────────────────────────────────
step "Installing status line script -> $DEST_SCRIPT"
mkdir -p "$CLAUDE_DIR"
if [ -n "$SRC_SCRIPT" ]; then
  cp "$SRC_SCRIPT" "$DEST_SCRIPT"
  info "copied from $SRC_SCRIPT"
else
  info "downloading from $RAW_BASE/statusline.sh"
  curl -fsSL "$RAW_BASE/statusline.sh" -o "$DEST_SCRIPT"
fi
chmod +x "$DEST_SCRIPT"

# ── 5. Wire up settings.json ────────────────────────────────────────────────
step "Configuring $SETTINGS"
[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"

# Validate existing JSON before touching it.
if ! jq empty "$SETTINGS" >/dev/null 2>&1; then
  die "$SETTINGS is not valid JSON. Fix or remove it, then re-run."
fi

backup="$SETTINGS.bak.$(date +%Y%m%d%H%M%S)"
cp "$SETTINGS" "$backup"
info "backed up to $backup"

tmp=$(mktemp)
jq '.statusLine = {type: "command", command: "~/.claude/statusline.sh", padding: 0}' \
  "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
info "set .statusLine -> ~/.claude/statusline.sh"

# ── Done ────────────────────────────────────────────────────────────────
printf '\n%sStatus line installed.%s\n\n' "$bold$green" "$reset"
printf '%sNext steps:%s\n' "$bold" "$reset"
printf '  1. Set your terminal font to %s"%s"%s so the glyphs render.\n' "$dim" "$FONT_NAME" "$reset"
printf '     (Terminal/iTerm/VS Code → font settings → "%s")\n' "$FONT_NAME"
printf '  2. Restart Claude Code (or start a new session) to load the status line.\n\n'
