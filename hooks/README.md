# Claude Code Hooks

Personal global hooks for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). These live in `~/.claude/` (not in the plugin) so they apply to every session on the machine, whether or not the plugin is enabled.

## concise-reminder

A `UserPromptSubmit` hook that injects a few rules from the [Concise output style](../output-styles/concise.md) into model context on every prompt. Costs ~70 tokens per prompt.

**Not installed by default.** The output style is the primary mechanism, and Claude Code already re-injects a reminder of the active style on every turn. This hook is the fallback for when that stops being enough.

**What it does differently:** the built-in reminder is a *pointer* — "the Concise style is active, follow it." The style's actual text sits at the top of the context window, where instructions lose influence as a conversation grows. This hook injects the rule *text* at the recency-weighted end instead, which is a different lever, not a louder one.

**Keep it a strict subset.** Every sentence in the reminder must already appear in the output style. It runs at max recency, so a paraphrase that drifts from the style will win over the style itself — which is exactly how the first version of this hook ended up contradicting it.

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

Pick the two or three rules most likely to break rather than summarizing the whole style — a summary is a paraphrase, and paraphrases drift.

To keep changes reproducible, edit `hooks/concise-reminder.sh` in this repo and re-run the installer.
