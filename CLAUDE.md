# Claude Skills Plugin

A Claude Code plugin containing web development skills for Astro and Vite+React projects deployed to Netlify.

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
claude --plugin-dir /path/to/claude-skills
```

## Usage

Once installed, skills are available with the `seancdavis-skills:` namespace:

```
/seancdavis-skills:new-project
/seancdavis-skills:astro-best-practices
/seancdavis-skills:auth-design
```

Claude will also automatically invoke skills based on context.

## Available Skills

### Orchestration

| Skill                      | Description                                                              |
| -------------------------- | ------------------------------------------------------------------------ |
| `claude-md-template`       | Template for generating CLAUDE.md in new projects                        |
| `new-project`              | Scaffolds new Astro or Vite+React projects                               |
| `onboard-existing-project` | Integrates skills into existing projects, audits CLAUDE.md for conflicts |

### Frameworks

| Skill                  | Description                                              |
| ---------------------- | -------------------------------------------------------- |
| `astro-best-practices` | Astro patterns: Netlify adapter, React islands, SSR      |
| `vite-best-practices`  | Vite+React patterns: React Router, progressive rendering |

### Architecture

| Skill              | Description                               |
| ------------------ | ----------------------------------------- |
| `routing-design`   | Rails-style CRUD routes, URL conventions  |
| `component-design` | Component architecture, skeleton patterns |

### Auth & UX

| Skill         | Description                                                 |
| ------------- | ----------------------------------------------------------- |
| `auth-design` | Netlify Identity with Google OAuth, approved users safelist |
| `feedback`    | Toast notifications, query param messages                   |
| `forms`       | HTTP forms (Astro) vs JSON forms (React)                    |

### Data Infrastructure

| Skill               | Description                                      |
| ------------------- | ------------------------------------------------ |
| `data-storage`      | Netlify DB + Drizzle ORM, migrations             |
| `file-storage`      | Netlify Blobs for non-image files                |
| `netlify-functions` | Modern function syntax (default exports, Config) |
| `netlify-images`    | Image upload, storage, CDN optimization          |

### Operations

| Skill                    | Description                         |
| ------------------------ | ----------------------------------- |
| `logging-and-monitoring` | Three-level logging, scoped loggers |
| `environment-variables`  | Netlify CLI management              |

### Project Documentation

| Skill                  | Description                                          |
| ---------------------- | ---------------------------------------------------- |
| `grill-me`             | Slash command for pre-execution alignment interviews |
| `paper-trail`          | Per-session log of grill outcomes (`docs/sessions/`) |
| `decision-log`         | Architecture Decision Records (`docs/decisions/`)    |
| `operating-principles` | Living current-state doc (`docs/principles.md`)      |

### Supplementary

| Skill          | Description                               |
| -------------- | ----------------------------------------- |
| `ai-workflows` | Netlify AI Gateway, Anthropic/OpenAI SDKs |
| `email`        | Transactional email with Resend           |
| `seo`          | Meta tags, Open Graph, structured data    |
| `ui-design`    | Tailwind CSS v4, accessibility baseline   |

### Utilities

| Skill     | Description                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------ |
| `clip`    | `/clip` — copy conversation output to the system clipboard as raw Markdown (general-purpose, not web-dev-specific)       |
| `release` | `/release` — bump the plugin version across both manifests, update `CHANGELOG.md`, commit, and tag (user-invocable only) |

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
