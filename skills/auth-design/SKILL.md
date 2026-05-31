---
name: auth-design
description: Personal conventions for auth on Netlify projects using Netlify Identity. Use when implementing user authentication, protecting routes/pages/functions, managing sessions, or gating access by safelist. Covers the three-tier access framework, the approved-users-table opinion (and why-not app_metadata.roles), the `getUserWithApproval` API shape, data scoping, and the Identity-doesn't-work-with-netlify-dev gotcha. The Identity SDK itself is covered by Netlify's netlify-identity skill.
---

# Auth Design — Conventions

For the `@netlify/identity` API (`oauthLogin`, `getUser`, `handleAuthCallback`, `logout`, `onAuthChange`), dashboard configuration, and event functions, see Netlify's `netlify-identity` skill.

This file covers the opinion layer on top.

---

## Defaults

- **Google OAuth is the only login method.** Enable Google in **Project configuration > Identity > External providers** and omit the email/password form from the UI. There's no "email provider" toggle in Identity — the front-end is the gate.
- **Registration is "Invite only" by default.** Set in **Project configuration > Identity > Registration**. Identity's default is open signup; Sean's projects aren't open-signup apps, so this gets flipped on every project.

---

## Three tiers of access

### Tier 1 — Personal/private apps

Apps only Sean uses. Mark the Netlify site as private → uses Netlify team SSO. No auth code, no Identity. Skip the rest of this skill.

### Tier 2 — Apps with specific external users

The common case. Netlify Identity + Google OAuth + an `approved_users` table. Identity authenticates; the safelist decides who can actually use the app.

### Tier 3 — Machine-to-machine / public APIs / MCP servers

Bearer token in `Authorization` header, validated against an env var. Use this for MCP endpoints, webhook receivers, and any non-browser caller. See the [API key pattern](#api-key-pattern-tier-3) below.

---

## Approved-users safelist (Tier 2)

Identity supports `app_metadata.roles` for authorization, but Sean uses a separate `approved_users` table instead. Reasons:

- A real table can be queried, edited, and joined against — admin tooling is just a CRUD page.
- Survives a provider switch. The day Identity gets replaced, the gate logic moves but the data stays.
- Keeps the auth provider's job small: authenticate, that's it.

### Schema

```typescript
// db/schema.ts
import { boolean, integer, pgTable, varchar, text, timestamp } from 'drizzle-orm/pg-core';

export const approvedUsers = pgTable('approved_users', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  email: varchar({ length: 255 }).notNull().unique(),
  name: varchar({ length: 255 }),
  customImage: varchar('custom_image', { length: 255 }),
  isAdmin: boolean('is_admin').notNull().default(false),
  addedAt: timestamp('added_at').defaultNow(),
  addedBy: varchar('added_by', { length: 255 }),
  notes: text(),
});
```

### `getUserWithApproval(request)`

This is the API the rest of the codebase calls. Shape is stable across provider changes:

```typescript
// src/lib/auth.ts
import { getUser } from '@netlify/identity';
import { eq } from 'drizzle-orm';
import { db, approvedUsers } from '../db';

export type AuthResult = {
  user: { id: string; email: string; name: string | null };
  isApproved: boolean;
  isAdmin: boolean;
};

export async function getUserWithApproval(_request: Request): Promise<AuthResult | null> {
  const user = await getUser();
  if (!user) return null;

  const [approved] = await db
    .select()
    .from(approvedUsers)
    .where(eq(approvedUsers.email, user.email))
    .limit(1);

  return {
    user: { id: user.id, email: user.email, name: user.name ?? null },
    isApproved: !!approved,
    isAdmin: approved?.isAdmin ?? false,
  };
}
```

The `request` parameter is unused by `@netlify/identity` (the SDK reads session state from the function's async context), but the signature is kept so call sites in Astro pages pass `Astro.request` — it documents that this is server-side code.

---

## Astro pattern

Protected page — auth check at the top of the frontmatter, redirects before render:

```astro
---
import { getUserWithApproval } from '../lib/auth';
const auth = await getUserWithApproval(Astro.request);
if (!auth) return Astro.redirect('/login');
if (!auth.isApproved) return Astro.redirect('/unauthorized');
---
<Layout title="Dashboard">
  <DashboardPage user={auth.user} isAdmin={auth.isAdmin} />
</Layout>
```

Sign-in is a one-line client island calling `oauthLogin('google')`. OAuth callback runs in the browser via `handleAuthCallback()` — no `/api/auth/callback` route needed. Mount a small `client:load` island on every page (or at least `/` and `/login`) whose `useEffect` calls `handleAuthCallback().catch(console.error)`.

---

## Vite + React pattern

One `AuthProvider` context that calls `handleAuthCallback()` then `getUser()` on mount, and subscribes to `onAuthChange`. Route guards live in the layout, not on every route — a single `if (!user) return <Navigate to={`/login?returnTo=...`} />` covers the whole protected subtree.

For client → function calls, **don't pass user info via headers** — the function calls `getUser()` itself. Headers can be forged; the SDK's cookie validation can't.

---

## Netlify Functions — `requireAuth` wrapper

Every protected function wraps its handler. Keeps the auth check off the body of each function:

```typescript
// netlify/functions/_shared/auth.ts
import type { Context } from '@netlify/functions';
import { getUser } from '@netlify/identity';

type Handler = (req: Request, ctx: Context) => Response | Promise<Response>;

export function requireAuth(handler: Handler): Handler {
  return async (req, ctx) => {
    const user = await getUser();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    return handler(req, ctx);
  };
}
```

For routes that also need the safelist check, write a parallel `requireApproved` that calls `getUserWithApproval` and 403s on `!isApproved` — same wrapper shape.

---

## API key pattern (Tier 3)

MCP endpoints, webhook receivers, public API routes — anything not coming from a browser session. Bearer token in `Authorization`, compared against an env var:

```typescript
// netlify/functions/_shared/bearer.ts
export function checkBearer(req: Request): boolean {
  const expected = process.env.MCP_BEARER_TOKEN;
  if (!expected) return false;
  const match = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i);
  return !!match && match[1] === expected;
}
```

Usage:

```typescript
export default async (req: Request) => {
  if (!checkBearer(req)) return new Response('Unauthorized', { status: 401 });
  // ...
};
```

One token per env var, named for the consumer (`MCP_BEARER_TOKEN`, `WEBHOOK_TOKEN`, etc.) — not a single shared `API_TOKEN`. Makes rotation surgical.

---

## Data scoping

Every query against user-owned data filters by the authenticated user's ID. Return **404, not 403**, when a resource exists but doesn't belong to the requester — a 403 confirms the row exists, which leaks structure to anyone enumerating IDs.

```typescript
const [run] = await db
  .select()
  .from(runs)
  .where(and(eq(runs.id, runId), eq(runs.userId, auth.user.id)));
if (!run) return Response.json({ error: 'Not found' }, { status: 404 });
```

For sub-resources (sessions belonging to a run), check ownership of the parent rather than denormalizing `userId` onto every child table. This rule also lives in `data-storage` — same rule, two places it gets violated.

---

## Auth logging

Standard vocabulary, scoped logger:

```typescript
const log = logger.scope('AUTH');

log.info('User authenticated:', user.email);
log.warn('Unapproved user attempted access:', email);
log.error('Session verification failed');
```

See `logging-and-monitoring` for the Discord notification integration that picks up `warn`/`error`.

---

## Local dev — Identity does not work with `netlify dev`

This conflicts with the standard "always run via netlify dev" workflow (see `environment-variables`). Identity flows can only be exercised against a deploy. Build UI shells locally with `netlify dev` and mock `getUserWithApproval` to return a fake user; for real auth testing, push to a branch and use the Netlify deploy preview. Don't write `if (dev)` branches in auth code — mock at the call site instead.

---

## Common pitfalls

1. **Registration left as Open** — Identity's default. Flip to Invite-only on every new project.
2. **Skipping the safelist check** — being authenticated isn't being approved. The pattern is `if (!auth) → /login; if (!auth.isApproved) → /unauthorized`.
3. **Trusting client headers for user ID** — pass nothing; the function calls `getUser()` itself.
4. **Forgetting `handleAuthCallback()`** — OAuth comes back with a URL hash; without the callback handler, the session never sticks.
5. **Testing auth with `netlify dev`** — it won't work. Push to a branch preview.

---

## Related skills

- Netlify's `netlify-identity` skill — SDK API surface and dashboard configuration
- `data-storage` — `approved_users` table lives here; data scoping rule duplicated for visibility
- `netlify-functions` — `_shared/auth.ts` content (the `requireAuth` wrapper)
- `logging-and-monitoring` — `logger.scope('AUTH')` and Discord routing
- `environment-variables` — where `MCP_BEARER_TOKEN` and friends live
