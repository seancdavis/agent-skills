---
name: data-storage
description: Personal conventions for data storage on Netlify (Netlify DB + Drizzle, or Netlify Blobs). Use when deciding where data should live, designing schemas, or writing queries that touch user-owned data. Covers the Blobs-vs-DB decision, timestamp migrations and the reason for them, never-use-db:push, and the user-scoped query rule. DB setup, Drizzle config, and migration commands are covered by Netlify's netlify-database skill.
---

# Data Storage — Conventions

For `netlify database init`, Drizzle config, connection setup, migration commands, and database branching, see Netlify's `netlify-database` skill. For Blobs API mechanics, see `netlify-blobs`.

This file covers the decisions and rules on top.

---

## Blobs vs DB — default to DB

| Use Blobs when... | Use DB when... |
|---|---|
| Storing files (images, documents) | Storing structured data |
| A handful of records, no growth expected | Data will grow over time |
| No relational needs | Need queries, filtering, relations |
| Want zero third-party dependencies | Need SQL capabilities |

**Default to Netlify DB** for non-trivial apps. The Blobs case for "a few records" is real but small — if you're tempted to query, filter, or relate, you already need a DB.

---

## Use timestamp prefixes for migrations

Configure Drizzle with `prefix: 'timestamp'`. The reason is parallel branches: two branches that both add a "0003" migration will conflict on merge. Timestamp prefixes (`20240116123456_add_users_table.sql`) sidestep that entirely.

Filenames are longer and you can't count migrations at a glance — fine trade for losing the merge-conflict class of bug.

---

## Never use `db:push`

Always go `db:generate` → `db:migrate`, including in development. `db:push` bypasses migration tracking, which leads to:

- Orphaned migration files that can't be applied (because the DB is already "ahead")
- Mismatch between migration history and actual schema
- Branches that worked locally but blow up the first time someone else runs migrations

The only exception is the very first migration on a fresh project. After that, `db:push` should not appear in your workflow.

---

## User-scoped queries — every read, every write

When a table has a `userId` column (or any foreign key to a users table), every `SELECT`, `UPDATE`, and `DELETE` against that table must include `WHERE userId = ?` for the authenticated user. No exceptions, no "I'll fix the missing filter later" — that's how user A ends up seeing user B's data.

For sub-resources (e.g. fetching `sessions` belonging to a `run`), verify ownership of the **parent** rather than denormalizing `userId` onto every child table:

```typescript
// Good — ownership check at the query level
const [run] = await db
  .select()
  .from(runs)
  .where(and(eq(runs.id, runId), eq(runs.userId, auth.userId)));

if (!run) {
  return Response.json({ error: 'Run not found' }, { status: 404 });
}

// Bad — fetching without ownership check
const [run] = await db.select().from(runs).where(eq(runs.id, runId));
```

When a resource exists but doesn't belong to the requesting user, return **404, not 403** — a 403 confirms the resource exists, which leaks structure to an attacker enumerating IDs.

---

## Related

- Netlify's `netlify-database` skill — DB setup, Drizzle config, migrations
- Netlify's `netlify-blobs` skill — Blobs API surface
- `file-storage` — Blob conventions for non-image files
- `netlify-images` — Blob conventions for images
- `auth-design` — where `auth.userId` comes from
