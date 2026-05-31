---
name: netlify-functions
description: Personal conventions for organizing Netlify Functions in TypeScript projects. Use when creating Netlify Functions (API endpoints for Vite + React apps, or mutation endpoints in Astro apps). Covers the _shared/ directory pattern, path-config-in-file convention, and a CRUD function template. Function syntax/setup itself is covered by Netlify's netlify-functions skill.
---

# Netlify Functions — Conventions

For function syntax (`default async` handler, `Config` export, `context.params`, etc.), see Netlify's `netlify-functions` skill.

This file covers organizational conventions on top.

---

## Put `path` config in the function file, not netlify.toml

The route belongs next to the code that handles it. Open the file → see the route. Searching `netlify.toml` to find what `/api/items` maps to is friction nobody needs.

```typescript
export const config: Config = {
  path: '/api/items/:id',
  method: ['GET', 'PUT', 'DELETE'],
};
```

---

## `_shared/` directory for cross-function code

Shared utilities live in `netlify/functions/_shared/`. The underscore prefix prevents Netlify from treating these files as functions themselves.

```
netlify/functions/
├── _shared/
│   ├── auth.ts
│   ├── db.ts
│   └── utils.ts
├── items.ts
└── upload.ts
```

Typical contents:

- `_shared/db.ts` — exports a single `db` Drizzle instance + re-exports schema. Importing `db` here gives every function the same connection pattern.
- `_shared/auth.ts` — exports `requireAuth(request)` returning `{ authenticated, userId, email, permissions }`. Every mutation function calls this at the top.
- `_shared/utils.ts` — anything else shared. Stays small or splits into more focused files.

---

## Use `context.params`, never parse the URL yourself

If the path is `/api/items/:id`, read `id` from `context.params`. Hand-rolled `url.pathname.split("/")` parsing is a smell — it duplicates what the config already declared and breaks the moment the route shape changes.

```typescript
// Good
const { id } = context.params;

// Bad
const id = new URL(request.url).pathname.split('/').pop();
```

---

## CRUD function template

When a resource needs full CRUD, prefer one function file handling all methods (with `path: ['/api/items', '/api/items/:id']`) over splitting into 4 files. The auth check happens once, the file maps cleanly to the resource, and the route table stays compact.

```typescript
// netlify/functions/items.ts
import type { Context, Config } from '@netlify/functions';
import { db, items } from './_shared/db';
import { eq } from 'drizzle-orm';
import { requireAuth } from './_shared/auth';

export default async (request: Request, context: Context) => {
  const { id } = context.params;

  if (request.method === 'GET') {
    if (id) {
      const [item] = await db
        .select()
        .from(items)
        .where(eq(items.id, parseInt(id)))
        .limit(1);
      if (!item) return Response.json({ error: 'Not found' }, { status: 404 });
      return Response.json(item);
    }
    return Response.json(await db.select().from(items));
  }

  const auth = await requireAuth(request);
  if (!auth.authenticated) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (request.method === 'POST') {
    const [newItem] = await db.insert(items).values(await request.json()).returning();
    return Response.json(newItem, { status: 201 });
  }

  if (request.method === 'PUT' && id) {
    const [updated] = await db
      .update(items)
      .set({ ...(await request.json()), updatedAt: new Date() })
      .where(eq(items.id, parseInt(id)))
      .returning();
    if (!updated) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json(updated);
  }

  if (request.method === 'DELETE' && id) {
    await db.delete(items).where(eq(items.id, parseInt(id)));
    return Response.json({ success: true });
  }

  return new Response('Method not allowed', { status: 405 });
};

export const config: Config = {
  path: ['/api/items', '/api/items/:id'],
  method: ['GET', 'POST', 'PUT', 'DELETE'],
};
```

---

## Related

- Netlify's `netlify-functions` skill — function syntax and platform mechanics
- `auth-design` — `_shared/auth.ts` content
- `data-storage` — `_shared/db.ts` content
