# Agent Skills Plugin

A Claude Code plugin of skills for how work gets done with Claude: alignment interviews, unattended build-and-audit runs, opening and reviewing PRs, broad research, and writing in your own voice. Netlify platform guidance lives in Netlify's official skills, not here.

## Installation

### Option 1: Global Installation (All Projects)

Add this repository as a marketplace, then install the plugin:

```bash
# Add marketplace
/plugin marketplace add seancdavis/agent-skills

# Install plugin (choose "user" scope for global)
/plugin install seancdavis-skills
```

### Option 2: Per-Project Installation

For a specific project, install with "project" or "local" scope:

```bash
# Add marketplace (if not already added)
/plugin marketplace add seancdavis/agent-skills

# Install for this project only
/plugin install seancdavis-skills
# Select "project" (shared via git) or "local" (not shared)
```

### Option 3: Local Development/Testing

Run Claude Code with the plugin directory:

```bash
claude --plugin-dir /path/to/agent-skills
```

## Usage

Once installed, skills are available with the `seancdavis-skills:` namespace:

```
/seancdavis-skills:preflight
/seancdavis-skills:review-pr
/seancdavis-skills:grill-me
```

Claude will also automatically invoke skills based on context.

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

| Skill            | Description                                                                       |
| ---------------- | --------------------------------------------------------------------------------- |
| `human-readable` | Writing mode for public-facing prose: voice profile + anti-AI-tell rules          |
| `update-voice`   | `/update-voice` — build or refresh the personal voice profile from actual writing |

### Code Review

| Skill       | Description                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------- |
| `open-pr`   | `/open-pr` — push the branch and open a PR with a concise, human-first body                       |
| `review-pr` | `/review-pr` — adversarial PR review; drafts a pending review, or prints findings for your own PR |

### Utilities

| Skill          | Description                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `clip`         | `/clip` — copy conversation output to the system clipboard as raw Markdown                                               |
| `dumb-it-down` | `/dumb-it-down` — redo the last answer in plain, literal terms, assuming no memory of how the system works               |
| `release`      | `/release` — bump the plugin version across both manifests, update `CHANGELOG.md`, commit, and tag (user-invocable only) |

## Project Structure

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

## Skill Development

### SKILL.md Frontmatter

```yaml
---
name: skill-name
description: Comprehensive description - this determines when Claude invokes the skill
---
```

### Optional Frontmatter

- `disable-model-invocation: true` - Only user can invoke
- `user-invocable: false` - Only Claude can invoke (background knowledge)
- `allowed-tools` - Restrict available tools

### Guidelines

- Keep SKILL.md under 500 lines
- Move detailed reference material to `references/` directory
- Description must include all trigger conditions (not the body)
- Avoid redundant intro paragraphs that repeat the description
- Start body with first actionable section, not overview text

## Development Workflow

- Test locally: `claude --plugin-dir .`
- Commit after each meaningful change
- Use Prettier for formatting
