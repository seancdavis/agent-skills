---
name: ai-workflows
description: Personal conventions for integrating AI capabilities via Netlify's AI Gateway. Use when adding AI features (calling LLMs from server code, building AI-powered endpoints). Covers two real footguns that are easy to hit, plus a pattern for tying AI endpoints into the app's auth + feedback systems. Gateway setup and model availability are covered by Netlify's netlify-ai-gateway skill.
---

# AI Workflows — Conventions

For AI Gateway setup, env var injection, and the current list of available models, see Netlify's `netlify-ai-gateway` skill. For Anthropic-specific tuning (prompt caching, extended thinking, tool use), see the `claude-api` skill.

This file covers two footguns and one integration pattern.

---

## Initialize SDK clients **inside** request handlers, not at module scope

AI Gateway environment variables are injected at request time, not when the module loads. Initializing the client at module scope often "works" in local dev (because `netlify dev` is wrapping you) and then breaks silently in deployed functions — or worse, in production paths that take a different module-load order.

```typescript
// Wrong — env vars may not exist when the module evaluates
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic();
export const POST: APIRoute = async ({ request }) => {
  /* ... */
};

// Right — env vars are available at request time
import Anthropic from '@anthropic-ai/sdk';
export const POST: APIRoute = async ({ request }) => {
  const client = new Anthropic();
  // ...
};
```

Applies to all providers (Anthropic, OpenAI, Google Gemini).

---

## `GoogleGenAI` constructor needs an empty object

The Google SDK's `GoogleGenAI` constructor requires `{}` rather than no arguments when relying on AI Gateway's auto-injected env vars. Easy to miss because it's the only one of the three that behaves this way.

```typescript
import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({}); // not new GoogleGenAI()
```

---

## Integration pattern: AI endpoint with auth + redirect-based feedback

For mutation-style AI calls invoked from a form submission (Astro), the right shape is: auth check → validate input → call AI → store result → redirect with a feedback message. The AI call is just one step inside the existing form/feedback flow — don't invent a separate UX for it.

```typescript
// src/pages/api/ai/cleanup.ts
import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';
import { getUserWithApproval } from '../../../lib/auth';

export const POST: APIRoute = async ({ request, redirect }) => {
  const auth = await getUserWithApproval(request);
  if (!auth?.isAdmin) return redirect('/unauthorized', 302);

  const formData = await request.formData();
  const text = formData.get('text')?.toString();
  if (!text) return redirect('/?message=validation_error', 302);

  const client = new Anthropic();

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: `Clean up this text:\n\n${text}` }],
    });
    const cleaned = response.content[0].type === 'text' ? response.content[0].text : text;
    await saveCleanedText(cleaned);
    return redirect('/?message=ai_cleanup_complete', 302);
  } catch (error) {
    console.error('AI cleanup error:', error);
    return redirect('/?message=ai_error', 302);
  }
};
```

For Vite + React, the same flow lives in a Netlify Function and the client renders feedback from the JSON response — same structure, different transport.

---

## Related

- Netlify's `netlify-ai-gateway` skill — Gateway setup, env vars, model list
- `claude-api` skill — Anthropic-specific tuning (caching, thinking, tools)
- `auth-design` — `getUserWithApproval` usage
- `feedback` — the `?message=...` redirect convention
