---
name: file-storage
description: Opinionated conventions for non-image file storage on Netlify Blobs (documents, PDFs, exports). Use when implementing file uploads or downloads for non-image files. Covers store organization, required metadata, and forcing download via Content-Disposition. For image-specific handling with CDN optimization, see netlify-images instead.
---

# File Storage

For images with resizing/optimization, see `netlify-images` instead — that has its own URL conventions and CDN setup.

For Blobs API mechanics (`getStore`, `set`/`get`/`delete`/`list`, consistency options), see Netlify's `netlify-blobs` skill.

---

## Use separate stores per content type

Don't dump everything into one store. Pick a descriptive name per content type — keeps debugging sane and leaves room to tune consistency/retention per type later:

```typescript
getStore({ name: 'documents' }); // PDFs, docs
getStore({ name: 'exports' }); // generated exports
getStore({ name: 'images' }); // see netlify-images
```

---

## Always store contentType and originalFilename in metadata

Both are needed when serving the file back — `contentType` for the response header, `originalFilename` for the Content-Disposition. Without them you're either guessing or storing them somewhere else.

```typescript
await store.set(key, file, {
  metadata: {
    contentType: file.type,
    originalFilename: file.name,
    uploadedAt: new Date().toISOString(),
  },
});
```

---

## Serve non-image files as attachments

Default to forcing download with `Content-Disposition: attachment` rather than inline rendering. Inline rendering of arbitrary user-uploaded files is a footgun (PDF JS, HTML rendering, etc.).

```typescript
return new Response(blob, {
  headers: {
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${originalFilename}"`,
    'Cache-Control': 'public, max-age=31536000, immutable',
  },
});
```

---

## Related

- `netlify-images` — images with CDN optimization
- Netlify's `netlify-blobs` skill — Blobs API surface
