---
name: netlify-images
description: Personal URL conventions for serving user-uploaded images through Netlify's Image CDN. Use when implementing image upload/serving flows for either Vite + React or Astro. Covers the layered /img/:key/... URL cascade, named size presets (thumb/avatar/hero/etc.), the split between raw blob serve and CDN-transformed serve, client upload UX conventions, and responsive srcSet with presets. Blob mechanics and CDN parameters are covered by Netlify's netlify-blobs and netlify-image-cdn skills.
---

# Netlify Images — Conventions

For Blobs storage (`getStore`, `set`/`get`), see Netlify's `netlify-blobs` skill. For CDN parameter semantics (`w`, `h`, `fit`, `q`, `fm`, etc.), see `netlify-image-cdn`.

This file covers URL conventions and upload UX patterns.

---

## Two-tier URL split: `/uploads/:key` raw, `/img/...` transformed

Serve the raw blob from `/uploads/:key` (a function or API route that streams the blob with its stored content type) and let `/img/...` go through the Image CDN for transformation. Keep these separate so:

- The CDN always has a stable origin to point at
- You can hit the raw URL when debugging
- Tests can serve raw without invoking CDN behavior

The CDN redirects (in `netlify.toml`) point at `/uploads/:key`, never at the blob itself.

---

## Cascading `/img/:key/...` URL shape

Build a single layered URL pattern where each successive segment adds a parameter:

```
/img/:key
/img/:key/:width
/img/:key/:width/:height
/img/:key/:width/:height/:fit
/img/:key/:width/:height/:fit/:quality
/img/:key/:width/:height/:fit/:quality/:format
```

Maps to `netlify.toml` redirects that translate each form into `/.netlify/images?url=/uploads/:key&w=...&h=...&fit=...&q=...&fm=...`.

The reason for the cascade (vs. a single redirect with query params): URL paths are easier to read and reason about than query strings, easier to hardcode in templates, and easier to interpolate in JSX/Astro.

---

## Named size presets

Define preset routes for the sizes you actually use, so callers ask for `/img/thumb/abc.jpg` instead of memorizing dimensions:

```toml
# Thumbnail (150×150 square)
[[redirects]]
from = "/img/thumb/:key"
to = "/.netlify/images?url=/uploads/:key&w=150&h=150&fit=cover"
status = 200

# Avatar (256×256 square)
[[redirects]]
from = "/img/avatar/:key"
to = "/.netlify/images?url=/uploads/:key&w=256&h=256&fit=cover"
status = 200

# Hero (1200×675, 16:9)
[[redirects]]
from = "/img/hero/:key"
to = "/.netlify/images?url=/uploads/:key&w=1200&h=675&fit=cover"
status = 200

# Width-only presets
[[redirects]]
from = "/img/small/:key"
to = "/.netlify/images?url=/uploads/:key&w=300"
status = 200

[[redirects]]
from = "/img/medium/:key"
to = "/.netlify/images?url=/uploads/:key&w=600"
status = 200

[[redirects]]
from = "/img/large/:key"
to = "/.netlify/images?url=/uploads/:key&w=1200"
status = 200
```

A complete example with all the cascade routes plus presets is in [references/complete-netlify-toml.md](references/complete-netlify-toml.md).

---

## Upload constraints

- **4 MB max** — comfortably under function payload limits, big enough for any reasonable photo. Validate on the server, not just the client.
- **Allowed types: JPG, PNG, GIF, WebP.** Validate against `file.type` (MIME), not file extension.
- **Keys: UUID + original extension.** Predictable keys are a privacy/leak risk; UUIDs avoid collisions and don't expose user content.

---

## Client upload component shape

Forms submit `multipart/form-data` with a single file input. For Vite + React, the wrapping `<form>` posts to a Netlify Function and renders feedback from JSON. For Astro, the form posts to an API route and the route redirects back with a `?message=` flag (see `feedback` skill).

```tsx
// Vite + React — minimal shape
<form onSubmit={handleSubmit} encType="multipart/form-data">
  <input type="file" name="image" accept="image/jpeg,image/png,image/gif,image/webp" required />
  <button type="submit" disabled={uploading}>
    {uploading ? 'Uploading...' : 'Upload'}
  </button>
  {error && <p className="error">{error}</p>}
</form>
```

```astro
{/* Astro — works without JS */}
<form action="/api/upload" method="post" enctype="multipart/form-data">
  <input
    type="file"
    name="image"
    accept="image/jpeg,image/png,image/gif,image/webp"
    required
  />
  <button type="submit">Upload</button>
</form>
```

---

## Responsive `srcSet` tied to presets

Pair the preset routes with `srcSet` so the browser picks the right size:

```tsx
<img
  src={`/img/medium/${imageKey}`}
  srcSet={`
    /img/small/${imageKey} 300w,
    /img/medium/${imageKey} 600w,
    /img/large/${imageKey} 1200w
  `}
  sizes="(max-width: 600px) 300px, (max-width: 1200px) 600px, 1200px"
  alt="..."
/>
```

The presets give you a small, fixed vocabulary instead of hand-rolled dimensions scattered across templates.

---

## Related

- Netlify's `netlify-blobs` skill — storage mechanics
- Netlify's `netlify-image-cdn` skill — CDN parameter reference
- `file-storage` — non-image file conventions
- `feedback` — `?message=...` redirect convention for upload success/failure
