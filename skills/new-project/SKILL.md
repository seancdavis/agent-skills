---
name: new-project
description: Orchestrates creating new web application projects for Sean. Use when starting a new project from scratch. Handles framework selection (Astro vs Vite+React), scaffolding, GitHub repo creation, Netlify setup instructions, and generates project CLAUDE.md. This is the entry point for all new projects.
---

# New Project Skill

This skill orchestrates the creation of new web application projects. It guides through framework selection, scaffolding, and infrastructure setup.

These skills layer Sean's opinions on top of Netlify's official skills. Assume Netlify's `netlify-functions`, `netlify-blobs`, `netlify-database`, `netlify-image-cdn`, `netlify-ai-gateway`, `netlify-identity`, etc. are also installed and are the source of truth for platform mechanics.

---

## Phase 1: Planning

Before writing any code, gather requirements and make architectural decisions.

### Framework Decision Matrix

| Choose Astro when...                           | Choose Vite + React when...              |
| ---------------------------------------------- | ---------------------------------------- |
| Content-heavy site (blog, docs, marketing)     | Highly interactive app (dashboard, tool) |
| Mostly read-only data display                  | Frequent data input and updates          |
| ~95% of UI has no interactions beyond clicking | Real-time updates or complex state       |
| SEO is critical                                | Client-side state management needed      |
| Progressive enhancement desired                | Heavy client-side logic                  |

**Default to Astro** unless there's a clear need for constant interactivity.

### Data Storage Decision

| Use Netlify Blobs when...              | Use Netlify DB when...             |
| -------------------------------------- | ---------------------------------- |
| Only storing files                     | Storing structured data            |
| Handful of records, no growth expected | Data will grow over time           |
| No relational needs                    | Need queries, filtering, relations |
| Want zero third-party dependencies     | Need SQL capabilities              |

**Default to Netlify DB** for most non-trivial applications.

### Questions to Clarify

1. What is the primary purpose of this app?
2. How interactive is the main experience?
3. Will users be creating/editing data frequently?
4. Who are the users? (Just Sean, specific people, public?)
5. Does it need authentication?
6. What data needs to be stored?

---

## Phase 2: Pre-Build Setup

### Step 1: Scaffold the Project

**If the project directory only contains `.claude/` folder** (skills installed before scaffolding):

```bash
# Scaffold to temp directory, then copy files over
# For Astro:
npm create astro@latest ../temp-scaffold -- --template minimal --typescript strict --no-install --no-git
cp -r ../temp-scaffold/* .
cp ../temp-scaffold/.gitignore . 2>/dev/null || true
rm -rf ../temp-scaffold
npm install
npx astro add netlify react tailwind

# For Vite + React:
npm create vite@latest ../temp-scaffold -- --template react-ts
cp -r ../temp-scaffold/* .
cp ../temp-scaffold/.gitignore . 2>/dev/null || true
rm -rf ../temp-scaffold
npm install
npm install react-router-dom
npm install -D @netlify/vite-plugin @netlify/functions @tailwindcss/vite tailwindcss
```

**If starting fresh from parent directory:**

```bash
# For Astro:
npm create astro@latest {project-name} -- --template minimal --typescript strict
cd {project-name}
npx astro add netlify react tailwind

# For Vite + React:
npm create vite@latest {project-name} -- --template react-ts
cd {project-name}
npm install react-router-dom
npm install -D @netlify/vite-plugin @netlify/functions @tailwindcss/vite tailwindcss
```

### Step 2: Configure the Project

**Astro - astro.config.mjs:**

```javascript
import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'server',
  adapter: netlify(),
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
});
```

**Vite + React - vite.config.ts:**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import netlify from '@netlify/vite-plugin';

export default defineConfig({
  plugins: [react(), tailwindcss(), netlify()],
});
```

### Step 3: Configure package.json scripts

**Astro:**

```json
{
  "scripts": {
    "dev": "netlify dev --no-open",
    "build": "astro build",
    "preview": "astro preview"
  }
}
```

**Vite + React:**

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  }
}
```

### Step 4: Create netlify.toml

**Astro:**

```toml
[build]
  command = "npm run build"
  publish = "dist"

[dev]
  command = "astro dev"
  targetPort = 4321
```

**Vite + React:**

```toml
[build]
  command = "npm run build"
  publish = "dist"
  functions = "netlify/functions"

[dev]
  command = "npm run dev"
  targetPort = 5173
```

### Step 5: Initialize Git and Create GitHub Repo

```bash
git init
git add .
git commit -m "Initial project setup"

# Create GitHub repo (uses gh CLI)
gh repo create {project-name} --private --source=. --push
```

---

## Phase 3: Manual Setup (User Action Required)

**STOP HERE** and instruct Sean to complete these steps:

### Required Steps

1. **Create Netlify Site**
   - Go to https://app.netlify.com/sites
   - Click "Add new site" → "Import an existing project"
   - Select the GitHub repo just created
   - Deploy with default settings

2. **Link Local Project**

   ```bash
   netlify link
   ```

3. **Initialize Database (if using Netlify DB)** — follow Netlify's `netlify-database` skill for the current init command and any post-init claim steps.

**Wait for Sean to confirm these steps are complete before proceeding.**

---

## Phase 4: Build

After Sean confirms setup is complete:

### If Using Netlify DB

Set up Drizzle per Netlify's `netlify-database` skill (config, scripts, connection). On top of that, apply the conventions in `data-storage`:

- Use `prefix: 'timestamp'` in `drizzle.config.ts` (see `data-storage` for the rationale)
- Never use `db:push` after the initial migration
- Every user-scoped table needs ownership filters on every query

### Generate CLAUDE.md

Use the `claude-md-template` skill to generate the project's CLAUDE.md file based on the chosen technologies.

### Apply Relevant Skills

Based on the project requirements, implement patterns from:

- `astro-best-practices` or `vite-best-practices`
- `auth-design` (if authentication needed)
- `data-storage` (if using database)
- `routing-design`
- `component-design`
- `feedback`
- `forms`
- `logging-and-monitoring`

---

## Checklist

### Pre-Build

- [ ] Framework decision made (Astro / Vite + React)
- [ ] Data storage decision made (Blobs / Netlify DB)
- [ ] Auth requirements identified
- [ ] Project scaffolded with CLI tools
- [ ] Git initialized and pushed to GitHub

### Manual Setup (Sean)

- [ ] Netlify site created and linked to GitHub
- [ ] Local project linked (`netlify link`)
- [ ] Database initialized (if needed, per Netlify's `netlify-database` skill)

### Build

- [ ] DB conventions from `data-storage` applied (timestamp migrations, no `db:push`)
- [ ] CLAUDE.md generated
- [ ] Relevant skills applied
- [ ] Initial commit pushed

---

## Anti-Patterns

- **Don't skip the manual setup phase** - Netlify infrastructure must exist before database work
- **Don't use sequential migration numbers** - Use timestamps to avoid branch conflicts
- **Don't install unnecessary dependencies** - Only add what's actually needed
- **Don't create complex folder structures** - Start simple, add organization as needed
- **Don't write boilerplate the CLI handles** - Use `npm create` and `npx astro add`
