---
name: claude-md-template
description: Template for generating CLAUDE.md files in new projects. Use this skill when scaffolding a new project to create the project's CLAUDE.md file. The generated file defines Claude's role as Sean's development partner and points to relevant skills based on the project's technology choices.
user-invocable: false
---

# CLAUDE.md Template Skill

This skill provides the template for generating `CLAUDE.md` files in new projects. The generated file serves as the project's primary context for Claude Code.

## Template Structure

The CLAUDE.md should be generated in the project root and customized based on:

- Framework choice (Astro vs Vite + React)
- Whether the project uses a database
- Whether the project requires authentication
- Any project-specific conventions

---

## Base Template

```markdown
# {PROJECT_NAME}

You are Sean's development partner on this project. Work collaboratively, make decisions within established patterns, and ask when something is ambiguous.

## Project Documentation

- **Current state:** `docs/principles.md` — architecture, conventions, and principles as they are now. Read this first.
- **Decisions:** `docs/decisions/` — ADRs explaining why each rule exists. Read when a rule seems arbitrary.
- **Session logs:** `docs/sessions/` — outcomes of past grill sessions. Skim recent ones for context.

When Sean wants to align on upcoming work, he uses `/grill-me`.

## Tech Stack

- **Framework:** {FRAMEWORK}
- **Styling:** Tailwind CSS v4
- **Hosting:** Netlify
  {DATABASE_SECTION}
  {AUTH_SECTION}

## Development

### Local Development

{DEV_COMMANDS}

### Database Commands

{DB_COMMANDS}

## Project Conventions

{CONVENTIONS}

## Skills Reference

When working on specific areas, reference these skills:

{SKILLS_LIST}

## Commit Guidelines

- Make atomic commits with clear messages
- Use conventional commit format: `type: description`
- Types: feat, fix, refactor, docs, style, test, chore
```

---

## Section Templates

### Framework: Astro

```markdown
- **Framework:** Astro with React components
```

Dev commands:

```markdown
\`\`\`bash

# Start dev server (wraps Astro with Netlify environment)

npm run dev # runs: netlify dev --no-open
\`\`\`
```

### Framework: Vite + React

```markdown
- **Framework:** Vite + React with React Router
```

Dev commands:

```markdown
\`\`\`bash

# Start dev server (Netlify Vite plugin injects environment)

npm run dev # runs: vite
\`\`\`
```

### Database Section

When using Netlify DB:

```markdown
- **Database:** Netlify DB (Neon) with Drizzle ORM
```

DB commands:

```markdown
\`\`\`bash

# Generate migration after schema changes

npm run db:generate

# Run migrations (preview branch)

npm run db:migrate

# Run migrations (production - requires confirmation)

npm run db:migrate:prod

# Open Drizzle Studio

npm run db:studio
\`\`\`
```

### Auth Section

When using Neon Auth:

```markdown
- **Auth:** Neon Auth with Google OAuth
```

### Skills List by Project Type

**Astro with Database and Auth:**

```markdown
- `/skills/astro-best-practices` - Astro patterns and conventions
- `/skills/auth-design` - Authentication implementation
- `/skills/data-storage` - Database patterns with Drizzle
- `/skills/routing-design` - URL structure conventions
- `/skills/feedback` - User feedback and toast patterns
- `/skills/forms` - Form submission patterns
- `/skills/logging-and-monitoring` - Server-side logging
- `/skills/netlify-functions` - API endpoint patterns (for mutations)
- `/skills/component-design` - Component organization
```

**Vite + React with Database and Auth:**

```markdown
- `/skills/vite-best-practices` - Vite + React patterns
- `/skills/auth-design` - Authentication implementation
- `/skills/data-storage` - Database patterns with Drizzle
- `/skills/routing-design` - URL structure with React Router
- `/skills/feedback` - Toast notifications
- `/skills/forms` - Form handling patterns
- `/skills/netlify-functions` - API endpoint patterns
- `/skills/component-design` - Component organization
- `/skills/logging-and-monitoring` - Server-side logging
```

---

## Example: Complete CLAUDE.md for Astro Project

```markdown
# soup-or-bowl

You are Sean's development partner on this project. Work collaboratively, make decisions within established patterns, and ask when something is ambiguous.

## Project Documentation

- **Current state:** `docs/principles.md` — architecture, conventions, and principles as they are now. Read this first.
- **Decisions:** `docs/decisions/` — ADRs explaining why each rule exists.
- **Session logs:** `docs/sessions/` — outcomes of past grill sessions.

When Sean wants to align on upcoming work, he uses `/grill-me`.

## Tech Stack

- **Framework:** Astro with React components
- **Styling:** Tailwind CSS v4
- **Hosting:** Netlify
- **Database:** Netlify DB (Neon) with Drizzle ORM
- **Auth:** Neon Auth with Google OAuth

## Development

### Local Development

\`\`\`bash

# Start dev server (wraps Astro with Netlify environment)

npm run dev # runs: netlify dev --no-open
\`\`\`

### Database Commands

\`\`\`bash

# Generate migration after schema changes

npm run db:generate

# Run migrations (preview branch)

npm run db:migrate

# Run migrations (production - requires confirmation)

npm run db:migrate:prod

# Open Drizzle Studio

npm run db:studio
\`\`\`

## Project Conventions

- React components go in `src/components/`, organized by feature
- Astro pages in `src/pages/` handle routing and data fetching
- API routes in `src/pages/api/` return redirects with message keys
- Database schema in `db/schema.ts`
- Utility functions in `src/lib/`

## Skills Reference

When working on specific areas, reference these skills:

- `/skills/astro-best-practices` - Astro patterns and conventions
- `/skills/auth-design` - Authentication implementation
- `/skills/data-storage` - Database patterns with Drizzle
- `/skills/routing-design` - URL structure conventions
- `/skills/feedback` - User feedback and toast patterns
- `/skills/forms` - Form submission patterns
- `/skills/logging-and-monitoring` - Server-side logging

## Commit Guidelines

- Make atomic commits with clear messages
- Use conventional commit format: `type: description`
- Types: feat, fix, refactor, docs, style, test, chore
```

---

## Generation Logic

When generating CLAUDE.md for a new project:

1. **Determine framework** from project setup decisions
2. **Include database section** if using Netlify DB
3. **Include auth section** if using Neon Auth
4. **Select relevant skills** based on project features
5. **Add project-specific conventions** based on folder structure
6. **Include the Project Documentation block** in every generated CLAUDE.md, even if `docs/principles.md` doesn't exist yet — its presence in CLAUDE.md is a forcing function to create one.

The new-project skill orchestrates this generation after scaffolding is complete.
