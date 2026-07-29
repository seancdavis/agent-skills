# Claude Code Hooks

Personal global hooks for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). These live in `~/.claude/` (not in the plugin) so they apply to every session on the machine, whether or not the plugin is enabled.

## concise-reminder

A `UserPromptSubmit` hook that injects a short reminder of the conciseness rules from the global `CLAUDE.md` into model context on every prompt.

**Why a hook and not just CLAUDE.md:** the global CLAUDE.md is loaded at the very top of the context window, and instructions there lose influence as a conversation grows — recency wins. Re-injecting a distilled version of the rules on every prompt keeps them at the recency-weighted end of context, where they actually get followed. Costs ~60 tokens per prompt.

## Install

From a checkout of this repo:

```bash
./hooks/install.sh
```

Or standalone, without cloning:

```bash
curl -fsSL https://raw.githubusercontent.com/seancdavis/agent-skills/main/hooks/install.sh | bash
```

The installer is idempotent (safe to re-run) and will:

1. Verify `jq` is installed (used to edit settings JSON).
2. Copy `concise-reminder.sh` to `~/.claude/hooks/` and make it executable.
3. Add the `UserPromptSubmit` entry to `~/.claude/settings.json`, backing up the original first. Skips this step if the hook is already registered.

## Manual setup

```bash
mkdir -p ~/.claude/hooks
cp hooks/concise-reminder.sh ~/.claude/hooks/concise-reminder.sh
chmod +x ~/.claude/hooks/concise-reminder.sh
```

Then add this to `~/.claude/settings.json` (merge with any existing `hooks`):

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/concise-reminder.sh"
          }
        ]
      }
    ]
  }
}
```

## Customizing

Edit the reminder text in `~/.claude/hooks/concise-reminder.sh` — it's a single JSON line with the reminder in `additionalContext`. Keep it short and imperative: a terse version of the rules at max recency beats the complete version at low recency, and a long block re-injected every turn dilutes itself.

To keep changes reproducible, edit `hooks/concise-reminder.sh` in this repo and re-run the installer.
