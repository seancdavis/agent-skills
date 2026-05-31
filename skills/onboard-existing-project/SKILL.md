---
name: onboard-existing-project
description: Onboards an existing project to use the seancdavis-skills plugin. Use after installing the plugin in an existing codebase. Assesses framework choice and existing patterns, adds skills reference to CLAUDE.md, audits for conflicting instructions, and updates or removes outdated content. Invoke with `/onboard-existing-project` after running `/plugin install seancdavis-skills`.
---

## Assumed companions

These skills layer Sean's opinions on top of Netlify's official skills. Assume Netlify's `netlify-functions`, `netlify-blobs`, `netlify-database`, `netlify-image-cdn`, `netlify-ai-gateway`, `netlify-identity`, etc. are also installed and are the source of truth for platform mechanics. This plugin only covers conventions on top of those.

---

## Step 1: Assess Framework and Technologies

Read these files to determine the framework and relevant skills:

```bash
# Framework detection
cat package.json          # Check dependencies
ls *.config.* 2>/dev/null # Config files present
```

| If you find...                          | Framework        | Primary skill            |
| --------------------------------------- | ---------------- | ------------------------ |
| `astro` in dependencies                 | Astro            | `astro-best-practices`   |
| `vite` + `react` (no Astro)             | Vite + React     | `vite-best-practices`    |

| If you find...                          | Additional skill                         |
| --------------------------------------- | ---------------------------------------- |
| `drizzle-orm` or `db/schema.*`          | `data-storage`                           |
| `@neondatabase/toolkit` or `neon_auth`  | `auth-design`                            |
| `@netlify/blobs`                        | `file-storage`                           |
| `@netlify/functions` or `netlify/functions/` | `netlify-functions`                 |
| `tailwindcss`                           | `ui-design`                              |
| `netlify.toml`                          | `netlify-functions`, `environment-variables` |

---

## Step 2: Assess Existing Code Patterns

Before modifying CLAUDE.md, understand what patterns the project already uses:

### Routing
- **Astro:** Check `src/pages/` structure - REST-style? Flat? Nested?
- **Vite+React:** Check router setup - React Router? File-based?

### Forms
- Check existing form submissions - HTTP redirects or JSON API calls?
- Look for form handling in API routes or page components

### Components
- Check `src/components/` organization - by feature? by type?
- Note any established naming conventions

### Data layer
- If using Drizzle, check `db/schema.ts` structure
- Note migration naming (timestamps vs sequential)

**Document any established patterns that differ from skills** - these are legitimate exceptions to preserve.

---

## Step 3: Add Skills Section to CLAUDE.md

### If no CLAUDE.md exists

Create minimal file:

```markdown
# {PROJECT_NAME}

## Skills

This project uses the `seancdavis-skills` plugin. When skill instructions conflict with patterns in this file, defer to the skills.

Relevant skills:
{SKILLS_LIST}
```

### If CLAUDE.md exists

Add near the top, after project description but before conventions:

```markdown
## Skills

This project uses the `seancdavis-skills` plugin. When skill instructions conflict with patterns in this file, defer to the skills.

Relevant skills:
- `{skill-name}` - {brief description}
```

---

## Step 4: Audit CLAUDE.md for Conflicts

Review existing CLAUDE.md sections against skills:

| CLAUDE.md section | Likely skill conflict | Resolution |
| ----------------- | --------------------- | ---------- |
| Routing conventions | `routing-design` | Remove if matches skill, keep exceptions |
| Database/ORM setup | `data-storage` | Remove generic, keep project-specific |
| Auth instructions | `auth-design` | Remove if using Neon Auth |
| Form patterns | `forms` | Remove if standard HTTP/JSON pattern |
| Deployment info | `netlify-functions` | Remove boilerplate |

### For each conflict

1. **Skill should win:** Remove the section
2. **Project has legitimate exception:** Keep with note:
   ```markdown
   > **Note:** This differs from `{skill-name}`. Reason: {why}.
   ```
3. **Section is outdated:** Remove it

### Safe to remove (skills cover these)
- Generic framework setup
- Standard Drizzle commands (`db:generate`, `db:migrate`)
- Boilerplate Netlify deployment
- Common toast/feedback patterns

### Keep (project-specific)
- Business logic unique to this project
- Custom API endpoints
- Third-party integrations not in skills
- Established team conventions that differ

---

## Step 5: Verify

1. Read final CLAUDE.md - is it coherent?
2. Skills section present with relevant skills listed?
3. No duplicate instructions between CLAUDE.md and skills?
