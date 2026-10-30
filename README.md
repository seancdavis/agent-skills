# Agent Skills

A [Claude Code](https://docs.anthropic.com/en/docs/claude-code) plugin with skills for how work gets done with Claude: alignment interviews, unattended build-and-audit runs, opening and reviewing PRs, broad research, and writing in your own voice.

## Installation

### Add the Marketplace

```bash
/plugin marketplace add seancdavis/agent-skills
```

### Install the Plugin

```bash
/plugin install seancdavis-skills
```

Choose your preferred scope:

- **user** — Available in all projects
- **project** — Shared via git with collaborators
- **local** — This machine only, not committed

## Usage

Skills are invoked automatically by Claude based on context, or manually:

```
/seancdavis-skills:preflight
/seancdavis-skills:review-pr
/seancdavis-skills:grill-me
```

## Available Skills

### Alignment & Unattended Runs

| Skill               | Description                                                                             |
| ------------------- | --------------------------------------------------------------------------------------- |
| `grill-me`          | `/grill-me` — pre-execution alignment interview; ends with a log in `docs/sessions/`    |
| `preflight`         | `/preflight` — settle a piece of work into a spec, so it can run unattended             |
| `autopilot`         | The unattended run: builds from the spec, audits with read-only Codex, opens the PR     |
| `autopilot-iterate` | `/autopilot-iterate` — picks an autopilot run back up from your PR review comments      |
| `research`          | `/research` — broad investigation, with the reading delegated to cheap models           |
| `roster`            | `/roster` — which model each subagent ran on, with generated-token and tool-call volume |

### Writing

| Skill            | Description                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| `human-readable` | Writing mode for public-facing prose — applies a personal voice profile plus anti-AI-tell rules     |
| `update-voice`   | `/update-voice` slash command — build or refresh the voice profile from the author's actual writing |

### Code Review

| Skill       | Description                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------- |
| `open-pr`   | `/open-pr` — push the branch and open a PR with a concise, human-first body                                         |
| `review-pr` | `/review-pr` — adversarial PR review; drafts a pending GitHub review, or prints findings in-session for your own PR |

### Utilities

| Skill          | Description                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| `clip`         | `/clip` slash command — copy conversation output to the system clipboard as raw Markdown                   |
| `dumb-it-down` | `/dumb-it-down` — redo the last answer in plain, literal terms, assuming no memory of how the system works |

## Output Style

This repo also ships the **Concise** output style — lead with the answer, teach in passing, then stop. It replaces Claude's default response-shape instructions for every turn of every session, so it holds where a one-time "be brief" decays. Install it with:

```bash
./output-styles/install.sh
```

See [`output-styles/README.md`](output-styles/README.md) for what it asks for and how to customize it.

## Status Line

This repo also ships a custom Claude Code status line (repo · branch · ticket · context-usage bar · cost · model). Install it on a Mac with:

```bash
./statusline/install.sh
```

The installer handles Homebrew, `jq`, and a Nerd Font, then wires the script into `~/.claude/settings.json`. See [`statusline/README.md`](statusline/README.md) for details and customization.

## Development

To test locally:

```bash
claude --plugin-dir /path/to/agent-skills
```

### Project Structure

```
.claude-plugin/
  plugin.json         # Plugin manifest
  marketplace.json    # Marketplace definition
skills/
  <skill-name>/
    SKILL.md          # Skill content (frontmatter + instructions)
    scripts/          # Optional: Executable code
    references/       # Optional: Documentation for context
output-styles/        # Response-shape styles (installed to ~/.claude)
statusline/           # Custom status line (installed to ~/.claude)
hooks/                # Hook scripts (installed to ~/.claude)
```

### Creating Skills

Each skill needs a `SKILL.md` with frontmatter:

```yaml
---
name: skill-name
description: Comprehensive description - determines when Claude invokes the skill
---
```

Keep skills under 500 lines. Move reference material to a `references/` directory.

## License

MIT
