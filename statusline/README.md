# Claude Code Status Line

A single-line status line for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) with Nerd Font icons and ANSI color.

```
 repo   branch   ABC-123                 ▓▓▓▓░░░░░░ 38%   $1.23    Opus 4.8
```

- **Left:** repo name · git branch (cyan when clean, yellow when dirty) · Linear-style ticket parsed from the branch (e.g. `ABC-123`)
- **Right:** context-usage bar + percentage · session cost · model name
- The context bar caps at 200K tokens, or 1M when the session reports a 1M-token model.

## Install (macOS)

From a checkout of this repo:

```bash
./statusline/install.sh
```

Or standalone, without cloning:

```bash
curl -fsSL https://raw.githubusercontent.com/seancdavis/claude-skills/main/statusline/install.sh | bash
```

The installer is idempotent (safe to re-run) and will:

1. Install [Homebrew](https://brew.sh) if it's missing.
2. Install `jq` if it's missing (used to parse Claude Code's JSON input).
3. Install the **JetBrainsMono Nerd Font** cask (`font-jetbrains-mono-nerd-font`) for the glyphs.
4. Copy `statusline.sh` to `~/.claude/statusline.sh` and make it executable.
5. Add the `statusLine` block to `~/.claude/settings.json`, backing up the original first.

### After installing

1. **Set your terminal font to a Nerd Font** so the icons render — the installer ships JetBrainsMono Nerd Font, but any Nerd Font works. Set it in Terminal, iTerm2, or your VS Code `terminal.integrated.fontFamily`.
2. **Restart Claude Code** (or start a new session) to pick up the status line.

## Manual setup

If you'd rather not run the script:

```bash
# 1. Dependencies (Homebrew assumed)
brew install jq
brew install --cask font-jetbrains-mono-nerd-font

# 2. Script
cp statusline/statusline.sh ~/.claude/statusline.sh
chmod +x ~/.claude/statusline.sh
```

Then add this to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.claude/statusline.sh",
    "padding": 0
  }
}
```

## Customizing

Edit `~/.claude/statusline.sh` directly. Common tweaks:

- **Colors** live in the `── Style ──` block as 256-color ANSI codes (e.g. `CYAN="${ESC}[38;5;75m"`).
- **Icons** are the `I_REPO` / `I_BRANCH` / `I_ISSUE` / `I_MODEL` glyphs — swap them for any [Nerd Font glyph](https://www.nerdfonts.com/cheat-sheet).
- **Ticket pattern** is the `grep -oE '[A-Z]{2,}-[0-9]+'` near the top — adjust for your issue-key format.

To keep changes reproducible, edit `statusline/statusline.sh` in this repo and re-run the installer.
