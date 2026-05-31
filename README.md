# Claude Skills for Web Development

A [Claude Code](https://docs.anthropic.com/en/docs/claude-code) plugin with opinionated skills for building Astro and Vite+React projects deployed to Netlify.

## What's Included

24 skills covering the full web development lifecycle:

| Category | Skills |
|----------|--------|
| **Project Setup** | New project scaffolding, CLAUDE.md generation, existing-project onboarding |
| **Frameworks** | Astro SSR patterns, Vite+React with React Router |
| **Architecture** | Rails-style routing, component design, skeleton patterns |
| **Auth** | Netlify Identity with Google OAuth, approved users safelist |
| **Data** | Netlify DB + Drizzle ORM, Netlify Blobs, image CDN |
| **UX** | Forms, toast notifications, feedback patterns |
| **Operations** | Logging, environment variables |
| **Project Documentation** | Grill-me interviews, session logs, ADRs, living principles doc |
| **Extras** | AI workflows, transactional email, SEO |

## Installation

### Add the Marketplace

```bash
/plugin marketplace add seancdavis/claude-skills
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
/seancdavis-skills:new-project
/seancdavis-skills:auth-design
/seancdavis-skills:data-storage
```

## Available Skills

### Orchestration

| Skill | Description |
|-------|-------------|
| `new-project` | Scaffolds new Astro or Vite+React projects with Netlify deployment |
| `onboard-existing-project` | Integrates skills into existing codebases; audits CLAUDE.md for conflicts |
| `claude-md-template` | Template for generating CLAUDE.md in new projects |

### Frameworks

| Skill | Description |
|-------|-------------|
| `astro-best-practices` | Astro patterns: Netlify adapter, React islands, SSR |
| `vite-best-practices` | Vite+React patterns: React Router, progressive rendering |

### Architecture

| Skill | Description |
|-------|-------------|
| `routing-design` | Rails-style CRUD routes, URL conventions |
| `component-design` | Component architecture, skeleton patterns |

### Auth & UX

| Skill | Description |
|-------|-------------|
| `auth-design` | Netlify Identity with Google OAuth, approved users safelist |
| `feedback` | Toast notifications, query param messages |
| `forms` | HTTP forms (Astro) vs JSON forms (React) |

### Data Infrastructure

| Skill | Description |
|-------|-------------|
| `data-storage` | Netlify DB + Drizzle ORM, migrations |
| `file-storage` | Netlify Blobs for non-image files |
| `netlify-functions` | Modern function syntax (default exports, Config) |
| `netlify-images` | Image upload, storage, CDN optimization |

### Operations

| Skill | Description |
|-------|-------------|
| `logging-and-monitoring` | Three-level logging, scoped loggers |
| `environment-variables` | Netlify CLI management |

### Project Documentation

| Skill | Description |
|-------|-------------|
| `grill-me` | `/grill-me` slash command — free-form pre-execution alignment interview |
| `paper-trail` | Per-session log format, stored in `docs/sessions/` |
| `decision-log` | Architecture Decision Records (ADRs), stored in `docs/decisions/` |
| `operating-principles` | Living current-state doc at `docs/principles.md` |

### Supplementary

| Skill | Description |
|-------|-------------|
| `ai-workflows` | Netlify AI Gateway, Anthropic/OpenAI SDKs |
| `email` | Transactional email with Resend |
| `seo` | Meta tags, Open Graph, structured data |
| `ui-design` | Tailwind CSS v4, accessibility baseline |

## Status Line

This repo also ships a custom Claude Code status line (repo · branch · ticket · context-usage bar · cost · model). Install it on a Mac with:

```bash
./statusline/install.sh
```

The installer handles Homebrew, `jq`, and a Nerd Font, then wires the script into `~/.claude/settings.json`. See [`statusline/README.md`](statusline/README.md) for details and customization.

## Tech Stack

These skills are designed for projects using:

- **Frameworks:** [Astro](https://astro.build) or [Vite](https://vitejs.dev) + [React](https://react.dev)
- **Deployment:** [Netlify](https://netlify.com)
- **Database:** [Netlify DB](https://docs.netlify.com/database/overview/) (Neon Postgres) + [Drizzle ORM](https://orm.drizzle.team)
- **Auth:** [Netlify Identity](https://docs.netlify.com/manage/security/identity/) with Google OAuth
- **Styling:** [Tailwind CSS v4](https://tailwindcss.com)

## Development

To test locally:

```bash
claude --plugin-dir /path/to/claude-skills
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
