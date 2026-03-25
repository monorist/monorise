# Best Practices

## Always proxy API requests through your server

**Never expose the monorise API Gateway directly to the client.** The API Gateway is protected only by an API key (`x-api-key`), which is a shared secret — if embedded in client-side code, anyone can extract it and manipulate your database directly.

Instead, proxy requests through your frontend server (e.g., Next.js API routes, Nuxt server routes, or any backend):

![Best Security Practice](/best-security-practice.png)

The frontend server acts as a **thin proxy layer** — its only job is to authenticate the user and attach the `x-api-key` header before forwarding to monorise. All business logic should live in monorise [custom routes](/custom-routes), not in the proxy layer.

### Next.js example

Create a catch-all API route that proxies to monorise:

```ts
// app/api/[...proxy]/route.ts
import { Resource } from 'sst';

const API_BASE_URL = Resource.CoreApi.url;
const API_KEY = process.env.API_KEY;

export async function GET(req: Request) {
  return proxy(req);
}

export async function POST(req: Request) {
  return proxy(req);
}

export async function PATCH(req: Request) {
  return proxy(req);
}

export async function DELETE(req: Request) {
  return proxy(req);
}

async function proxy(req: Request) {
  const url = new URL(req.url);
  const path = url.pathname.replace('/api', '');

  const response = await fetch(`${API_BASE_URL}${path}${url.search}`, {
    method: req.method,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY!,
      // Forward any auth headers from the client
      ...(req.headers.get('Authorization')
        ? { Authorization: req.headers.get('Authorization')! }
        : {}),
    },
    body: req.method !== 'GET' ? await req.text() : undefined,
  });

  return new Response(response.body, {
    status: response.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

Then configure `monorise/react` to point at your proxy instead of the API Gateway directly:

```ts
import { setMonoriseOptions } from 'monorise/react';

setMonoriseOptions({
  entityApiBaseUrl: '/api/core/entity',
  mutualApiBaseUrl: '/api/core/mutual',
  tagApiBaseUrl: '/api/core/tag',
});
```

### Why this matters

| Approach | API key visible to client? | Risk |
|----------|--------------------------|------|
| Client → API Gateway directly | Yes (in JS bundle or network tab) | Anyone can create/delete entities |
| Client → Your Server → API Gateway | No (server-side only) | API key stays secret |

### Additional benefits of proxying

- **Add your own auth layer** — validate JWTs, session tokens, or OAuth before forwarding to monorise
- **Rate limiting** — protect against abuse at the proxy layer
- **Request transformation** — enrich requests with server-side context (e.g., inject `tenantId` from session)
- **Audit logging** — log all API calls before they reach monorise

## Use environment-specific API keys

Don't reuse the same API key across environments. Configure separate keys for development, staging, and production via the `API_KEYS` SST secret:

```bash
# Set per-stage secrets
npx sst secret set API_KEYS '["dev-key-123"]' --stage dev
npx sst secret set API_KEYS '["prod-key-abc"]' --stage production
```

## Keep entity configs focused

Each entity config file should define a single entity. Avoid putting multiple entities in one file — the CLI expects one default export per file in the `configDir`.

```
monorise/configs/
  user.ts           ✓ one entity per file
  organisation.ts   ✓
  order.ts          ✓
```

## Prefer direct mutuals over prejoins

If you know the relationship at creation time, add a direct mutual field instead of using prejoins. Direct mutuals are cheaper (no write amplification) and simpler to reason about. See [Prejoins](/concepts/prejoins) for details.

## Use tags for access patterns, not data storage

Tags are for **querying** — filter by group, sort by value. Don't store business data in tag processors. The entity's `baseSchema` is the source of truth; tags are derived indexes.
