# Best Practices

## Always proxy API requests through your server

**Never expose the monorise API Gateway directly to the client.** The API Gateway is protected only by an API key (`x-api-key`), which is a shared secret — if embedded in client-side code, anyone can extract it and manipulate your database directly.

Instead, use the **edge-auth proxy pattern** — your frontend server sits between the client and monorise, acting as a thin auth layer:

![Best Security Practice](/best-security-practice.png)

The frontend server is a **thin proxy layer** — its only job is to authenticate the user, check that they may touch the records they ask for, and attach the `x-api-key` header before forwarding to monorise. All business logic should live in monorise [custom routes](/custom-routes), not in the proxy layer.

### Edge-auth proxy pattern with Next.js + SST

SST provides seamless Next.js deployment via `sst.aws.Nextjs`. This means your Next.js app already has a server — use its API routes as the proxy layer. No extra infrastructure needed.

Monorise Core creates the `API_KEYS` allow-list. Create a separate `X_API_KEY` secret in your application and pass it to the Next.js server, so only your backend proxy holds the selected key:

```ts
const { api } = new monorise.module.Core('core');
const xApiKey = new sst.Secret('X_API_KEY', 'secret1');

new sst.aws.Nextjs('web', {
  link: [api],
  environment: {
    API_BASE_URL: api.url,
    MONORISE_API_KEY: xApiKey.value,
  },
});
```

Reading the key from `MONORISE_API_KEY` keeps the proxy code identical in every app. A second app passes its own secret under the same name; see [several apps, one API](/api-keys#several-apps-one-api).

**The proxy route** — one file that reads the session, checks the user's rules, and forwards with the key:

```ts
// app/api/core/[...path]/route.ts
import config from '#/monorise';
import { createProxyHandler } from 'monorise/proxy';
import { readSession } from '#/lib/session';
import { customerRules } from '#/lib/proxy-rules';

export const { GET, POST, PUT, PATCH, DELETE } = createProxyHandler({
  config,
  authenticate: (request) => readSession(request), // your auth: 401 without a session
  apiKey: process.env.MONORISE_API_KEY,
  rules: customerRules, // e.g. a customer only reads their own orders
});
```

`monorise/react` already calls `/api/core/entity`, `/api/core/mutual`, `/api/core/tag` and `/api/core/transaction`, so every client-side hook (`useEntities`, `useMutuals`, etc.) now goes through your server, which checks the user and attaches the API key server-side. See [Proxy](/proxy) for rules, several kinds of caller, and other frameworks.

### Why this matters

| Approach | API key visible to client? | Risk |
|----------|--------------------------|------|
| Client → API Gateway directly | Yes (in JS bundle or network tab) | Anyone can create/delete entities |
| Client → Next.js Server → API Gateway | No (server-side only) | API key stays secret |

### Additional benefits

- **Auth at the edge** — validate JWTs, session tokens, or OAuth before forwarding to monorise
- **Per-user rules** — the proxy checks whose records each user touches, while the key limits what the app can reach at all
- **Rate limiting** — protect against abuse at the proxy layer
- **Bring your own auth** — the proxy pattern works with any auth provider (OpenAuth, AuthJs, Clerk, etc.) — just swap the `authenticate` function
- **Easy backend testing** — since auth lives in the proxy and the API Gateway only checks `x-api-key`, you can test the backend directly using HTTP clients like Postman, VS Code REST Client, or kulala (Neovim) without dealing with auth flows. Just create different environments with the right base URL and API key:

  ```http
  ### List members
  GET {{BASE_URL}}/core/entity/member
  x-api-key: {{X_API_KEY}}
  ```

## Use environment-specific API keys

Don't reuse the same API key across environments. Configure separate keys for development, staging, and production via the `API_KEYS` SST secret:

The two secrets have separate responsibilities:

| Secret | Purpose |
|--------|---------|
| `API_KEYS` | Rotatable allow-list used by Monorise Core to verify requests |
| `X_API_KEY` | One selected key held by your backend proxy and attached as the `x-api-key` request header |

```bash
# API Gateway accepts these keys (array of valid keys)
npx sst secret set API_KEYS '["dev-key-123"]' --stage dev
npx sst secret set API_KEYS '["prod-key-abc"]' --stage production

# Backend proxy sends one accepted key
npx sst secret set X_API_KEY 'dev-key-123' --stage dev
npx sst secret set X_API_KEY 'prod-key-abc' --stage production
```

::: tip
`API_KEYS` is an array so old and new keys can overlap during rotation. `X_API_KEY` is the single key sent by the proxy and must match one value in that array.
:::

## Give each app the narrowest key it needs

The proxy key can do anything by default. When several apps, services or agents call the same API, give each its own key on a [policy](/api-keys) that grants only what it uses: an admin app on `full`, a customer-facing app scoped to its entities and fields, and a reporting job on `'read'`. A bug or a missed auth check in one app's proxy then can't reach data that app never needed.

## Keep entity configs focused

Each entity config file should define a single entity. Avoid putting multiple entities in one file — the CLI expects one default export per file in the `configDir`.

```
monorise/configs/
  user.ts           ✓ one entity per file
  organisation.ts   ✓
  order.ts          ✓
```

## Prefer direct mutuals over tree processors

If you know the relationship at creation time, add a direct mutual field instead of using a tree processor. Direct mutuals are cheaper (no write amplification) and simpler to reason about. See [Tree Processors](/concepts/prejoins) for details.

## Use tags for access patterns, not data storage

Tags are for **querying** — filter by group, sort by value. Don't store business data in tag processors. The entity's `baseSchema` is the source of truth; tags are derived indexes.
