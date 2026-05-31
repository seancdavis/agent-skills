---
name: environment-variables
description: Personal conventions for managing environment variables in Netlify projects. Use when configuring API keys, managing secrets, or deciding where a variable lives (Netlify vs local). Covers the always-pull-from-Netlify principle, the rare local-only exception, and a warning about context-scoping. CLI mechanics are covered by Netlify's netlify-cli-and-deploy skill.
---

# Environment Variables — Conventions

For `netlify env:set` / `env:list` / `env:import` mechanics, deploy contexts, `--secret` flags, and `VITE_`/`PUBLIC_` prefix rules, see Netlify's CLI / config skills.

This file covers when to use which.

---

## Always pull from Netlify

Work within the Netlify environment context. `netlify dev` (Astro) and the Netlify Vite plugin (Vite + React) both inject variables automatically when the site is linked. Don't store secrets locally when you can avoid it — every local copy is another place to forget to rotate.

---

## Don't scope variables to a single context unless you have a reason

Default to setting variables for **all contexts** — omit `--context`. Scoping a variable to one context (e.g. only `production`) means it won't exist in deploy previews or local dev, and you'll spend an afternoon debugging a "missing env var" that's actually present in prod.

```bash
# Good: available everywhere
netlify env:set MY_VAR "value"

# Only with a specific reason (e.g. genuinely different prod vs preview URLs):
netlify env:set --context production API_URL "https://api.prod.com"
```

---

## Local-only exception: `.envrc` + direnv

For truly local-only values that don't belong in Netlify (debug toggles, throwaway overrides), use a `.envrc` file with direnv:

```bash
# .envrc — must be in .gitignore
export LOCAL_DEBUG=true
```

Use sparingly. If a variable matters enough to think about, it belongs in Netlify.

---

## Related

- Netlify's `netlify-cli-and-deploy` skill — `netlify env:*` commands
- Netlify's `netlify-config` skill — context and prefix semantics
