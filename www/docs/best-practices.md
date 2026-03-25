# Best Practices

## Always proxy API requests through your server

**Never expose the monorise API Gateway directly to the client.** The API Gateway is protected only by an API key (`x-api-key`), which is a shared secret — if embedded in client-side code, anyone can extract it and manipulate your database directly.

Instead, use the **edge-auth proxy pattern** — your frontend server sits between the client and monorise, acting as a thin auth layer:

![Best Security Practice](/best-security-practice.png)

The frontend server is a **thin proxy layer** — its only job is to authenticate the user and attach the `x-api-key` header before forwarding to monorise. All business logic should live in monorise [custom routes](/custom-routes), not in the proxy layer.

### Edge-auth proxy pattern with Next.js + SST

SST provides seamless Next.js deployment via `sst.aws.Nextjs`. This means your Next.js app already has a server — use its API routes as the proxy layer. No extra infrastructure needed.

**1. Proxy utility** — rewrites client requests to the monorise API Gateway, validates auth, and attaches `x-api-key`:

```ts
// app/api/proxy-request.ts
import { type NextRequest, NextResponse } from 'next/server';
import { Resource } from 'sst';
import { validateToken } from './validate-token';

function rewriteUrl(requestUrl: string, replacePath?: string) {
  const path = replacePath
    ?? requestUrl.replace(/^https?:\/\/[^\/]+(:d+)?\/api\//, '');
  return `${Resource.CoreApi.url}/${path}`;
}

export const proxyRequest = async ({
  req,
  path,
  skipAuthentication,
}: {
  req: NextRequest;
  path?: string;
  skipAuthentication?: boolean;
}) => {
  // 1. Validate auth (thin layer — only concern of the proxy)
  let accountId = '';
  if (!skipAuthentication) {
    const token = validateToken(req);
    if (token instanceof NextResponse) return token; // 401
    accountId = token.properties.accountId;
  }

  // 2. Parse body
  let body: string | undefined;
  try { body = JSON.stringify(await req.json()); } catch {}

  // 3. Forward to monorise with x-api-key
  return fetch(rewriteUrl(req.url, path), {
    method: req.method,
    body,
    headers: {
      'content-type': 'application/json',
      'account-id': accountId,
      'x-api-key': Resource.ApiKeys.value,
    },
    cache: 'no-store',
  });
};
```

**2. Catch-all API route** — forwards all `/api/*` requests through the proxy:

```ts
// app/api/[...proxy]/route.ts
import type { NextRequest } from 'next/server';
import { proxyRequest } from '../proxy-request';

export const GET = (req: NextRequest) => proxyRequest({ req });
export const POST = (req: NextRequest) => proxyRequest({ req });
export const PATCH = (req: NextRequest) => proxyRequest({ req });
export const PUT = (req: NextRequest) => proxyRequest({ req });
export const DELETE = (req: NextRequest) => proxyRequest({ req });
```

**3. Configure monorise/react** to point at your proxy:

```ts
setMonoriseOptions({
  entityApiBaseUrl: '/api/core/entity',
  mutualApiBaseUrl: '/api/core/mutual',
  tagApiBaseUrl: '/api/core/tag',
});
```

Now all client-side hooks (`useEntities`, `useMutuals`, etc.) route through your Next.js server, which validates auth and attaches the API key server-side.

### Why this matters

| Approach | API key visible to client? | Risk |
|----------|--------------------------|------|
| Client → API Gateway directly | Yes (in JS bundle or network tab) | Anyone can create/delete entities |
| Client → Next.js Server → API Gateway | No (server-side only) | API key stays secret |

### Additional benefits

- **Auth at the edge** — validate JWTs, session tokens, or OAuth before forwarding to monorise
- **Inject context** — enrich requests with server-side data (e.g., `account-id` from session)
- **Rate limiting** — protect against abuse at the proxy layer
- **Bring your own auth** — the proxy pattern works with any auth provider (OpenAuth, AuthJs, Clerk, etc.) — just swap the `validateToken` implementation

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
