# Proxy

The browser never calls Monorise Core directly: your app's server sits in between, reads the user's session and forwards the request with an [API key](/api-keys). `createProxyHandler` from `monorise/proxy` is that server route, in one file.

Two layers decide what gets through:

| Layer | Decides | Example |
|---|---|---|
| **The key**, checked by Core | What a kind of caller can reach: entity types, fields, relationships, routes | Customers can read orders and update their `notes` |
| **Rules**, checked by the proxy | Whose records this user can touch | Alice can only read Alice's orders |

The proxy checks rules before forwarding, so a request a rule refuses never reaches Core.

## Day 0: forward everything

`monorise init` generates this route:

```ts
// app/api/core/[...path]/route.ts
import config from '#/monorise';
import { allow, createProxyHandler } from 'monorise/proxy';

export const { GET, POST, PUT, PATCH, DELETE } = createProxyHandler({
  config,
  apiKey: process.env.MONORISE_API_KEY,
  rules: { '*': allow }, // the key alone decides
});
```

Every request is forwarded with one key, and there is no sign-in. That's right for local development and internal tools, not for an app with real users.

`monorise/react` already calls `/api/core/entity`, `/api/core/mutual`, `/api/core/tag` and `/api/core/transaction`, so the client needs no configuration.

## Users and kinds of caller

A client app usually has a few kinds of caller, such as signed-in customers and anonymous visitors. Each kind gets its own key, on a policy granting what that kind needs, and its own rules:

```ts
// lib/proxy.ts
import config from '#/monorise';
import { createProxyHandler } from 'monorise/proxy';
import { readSession } from '#/lib/session';
import { customerRules, publicRules } from '#/lib/proxy-rules';

export const proxy = createProxyHandler({
  config,
  // A session, undefined for an anonymous visitor, or a Response to send back
  authenticate: (request) => readSession(request),
  caller: ({ session }) => (session ? 'customer' : 'public'),
  callers: {
    customer: { apiKey: process.env.CUSTOMER_API_KEY, rules: customerRules },
    public: { apiKey: process.env.PUBLIC_API_KEY, rules: publicRules },
  },
});
```

```ts
// app/api/core/[...path]/route.ts
import { proxy } from '#/lib/proxy';

export const { GET, POST, PUT, PATCH, DELETE } = proxy;
```

- **Sessions stay yours.** `authenticate` reads cookies or tokens however your auth library does. A `Response` it returns, such as a 401 that clears an expired cookie, is sent back as is.
- **Every request is one kind of caller.** `caller` names an entry in `callers`; a name with no entry answers 401. Leave out `public` and anonymous visitors get 401 for everything.
- **Each table is strict on its own.** The public table doesn't mention orders, so visitors can't touch them, and no rule needs an `if (session.role === …)` branch.

An app with one kind of caller, such as an admin app for trusted staff, passes `apiKey` and `rules` directly. When it has `authenticate`, a request without a session answers 401:

```ts
export const proxy = createProxyHandler({
  config,
  authenticate: (request) => readStaffSession(request),
  apiKey: process.env.ADMIN_API_KEY,
  rules: { '*': allow },
});
```

## Rules

A rule decides whether this user may perform one operation. Rules are strict: **an operation without a matching rule is refused** with 403.

```ts
// lib/proxy-rules.ts
import { Entity } from '#/monorise';
import { type ProxyRule, type ProxyRules, allow } from 'monorise/proxy';

type Session = { userId: string };

// Is the user the record, or the relationship's owner?
const isMe: ProxyRule<Session> = (op, { session }) =>
  (op.kind === 'relationship' ? op.byEntityId : op.kind === 'entity' ? op.entityId : undefined) ===
  session?.userId;

// Is this order related to the user? IDs come from the request: encode them.
const isMyOrder: ProxyRule<Session> = async (op, { session, core }) => {
  if (!session || op.kind !== 'entity' || !op.entityId) return false;
  const userId = encodeURIComponent(session.userId);
  const orderId = encodeURIComponent(op.entityId);
  return (await core.get(`/mutual/user/${userId}/order/${orderId}`)).ok;
};

export const customerRules: ProxyRules<Session> = {
  [Entity.PRODUCT]: { get: allow, list: allow },
  [Entity.ORDER]: {
    get: isMyOrder,
    update: isMyOrder,
  },
  [Entity.USER]: {
    get: isMe,
    update: isMe,
    mutuals: {
      [Entity.ORDER]: { read: isMe }, // my orders
      [Entity.PRODUCT]: isMe,         // my wishlist: read, add, remove
    },
  },
};

export const publicRules: ProxyRules<Session> = {
  [Entity.PRODUCT]: { get: allow, list: allow },
};
```

### Operations

Rules are written against operations, not URLs, so a different request shape can't get around them: a transaction's `deleteEntity` is the same operation as `DELETE /entity/order/:id`.

| Request | Operations |
|---|---|
| `GET /entity/:type/:id`, `GET /entity/:type/unique/:field/:value` | `get` on the entity |
| `GET /entity/:type`, `GET /tag/:type/:tag` | `list` on the entity, with its `query`, `start` and `end`, and a tag listing's `tag` and `group` |
| `POST /entity/:type` | `create` |
| `PATCH /entity/:type/:id` | `update` |
| `POST /entity/:type/:id/adjust` | `adjust`, with `adjustments` |
| `PUT /entity/:type/:id` | `create` and `update` |
| `DELETE /entity/:type/:id` | `delete` |
| `/mutual/:by/:byId/:type[/:id]` | relationship `read`, `create`, `update` or `delete`; a `create` that materializes an entity is also that entity's `create` |
| `POST /transaction` | each entry as above, each with its `operationIndex` |
| `/app/...` | a [custom route](#custom-routes) |

- **Relationship fields count as relationships.** Creating a user with `productIds: ['p1']` is a user `create` plus a user→product relationship `create`. Updating them is also a relationship `delete`, since the new list replaces the old one.
- **An adjust isn't an update.** API keys count it as one, but a rule written for the values an update sets would approve `adjust { credits: -500 }`. So rules see `adjust`, with the amount added to each numeric field: `adjust: (op) => (op.adjustments?.credits ?? 0) >= 0`. A table without an `adjust` rule, or a `'*'`, refuses adjusts.
- **An `asEntity` create counts too.** When creating a relationship also creates an entity, through `asEntity` in its mutual config or `?asEntity=`, that entity's `create` rule runs as well. Its `payload` is the relationship's `mutualData`, and `asEntityOf` names the relationship. Updates and deletes reach that entity by replication, so only the create is checked.
- **A chain query reads every hop.** `GET /mutual/user/u1/video?chainEntityQuery=course,module` reads user→course, course→module and module→video. Only the first hop has a `byEntityId`.
- **One refusal refuses the whole request.** In a transaction, the 403 names the `operationIndex`, as Core does.

### How a rule is found

The most specific match wins:

| | Entity operation | Relationship operation | Custom route |
|---|---|---|---|
| 1 | `rules[type][action]` | `rules[type].mutuals[target][action]` | `routes['POST /app/…']`, then `:param` and `*` patterns |
| 2 | `rules[type]['*']`, or `rules[type]` as a single rule | `rules[type].mutuals[target]['*']`, then `rules[type].mutuals['*']`, or `rules[type]` as a single rule | `routes['*']` |
| 3 | `rules['*'][action]`, or `rules['*']` as a single rule | the same | `rules['*']` as a single rule |
| 4 | Refused | Refused | Refused |

So `rules: { '*': allow }` forwards everything the key allows, and a table without a top-level `'*'` refuses anything it hasn't decided about. An entity's own `'*'` covers its records, not its relationships.

In development, a refused operation with no rule also logs the rule to add:

```
[monorise/proxy] No rule for delete on 'order'. Add one: rules: { 'order': { delete: (operation, { session }) => … } }
```

### What a rule receives and returns

A rule is `(operation, context) => boolean | Response`, or a promise of one.

- **`operation`** is one operation from the table above. Under an entity and action it is narrowed: `rules[Entity.ORDER].update` gets an `EntityOperation<Entity.ORDER, 'update'>`, whose `payload` has the order's fields, and `rules[Entity.ORDER].adjust` gets `adjustments` for its numeric fields.
- **`context.session`** is what `authenticate` returned, or `undefined`.
- **`context.core`** calls Core with the caller's key, for checks such as "is this order the user's?": `core.get(path)` and `core.fetch(path, init)`.
- **`context.request`** is the original request, still readable.
- **`true` forwards** the operation. `false`, or anything else, refuses it with 403, so a rule that forgets to return fails closed. A `Response` is sent back as is.
- **`allow` and `deny`** are rules that always return `true` or `false`.

Rules see the payload before Core validates it, so every payload field is optional.

### Rules only veto

A rule can refuse an operation but never change it: the proxy forwards exactly the bytes it checked. Rules about values become refusals:

- **"A customer can't mark an order refunded":** refuse when `op.payload?.status === 'refunded'`.
- **"`email` comes from the sign-in, not the client":** leave `email` out of the key's `update` list, and set it where the record is created, such as a registration custom route.

### Listing your own things

A rule can't filter a listing row by row: the proxy sees the request, not the records that come back. Whether a kind of caller may list a whole type is the key's [`list` grant](/api-keys).

To show users only their own records, list them through a relationship from something they own, and check the parent's ID. `GET /mutual/user/:userId/order` lists a user's orders, and this rule makes sure the ID is theirs:

```ts
[Entity.USER]: {
  mutuals: {
    [Entity.ORDER]: { read: (op, { session }) => op.byEntityId === session?.userId },
  },
},
```

Tag listings work the same way when the tag is grouped by owner: the operation carries `tag` and `group`, so a rule can check that the group is the user's.

## Custom routes

Custom routes go through the same proxy, with two checks:

1. **The key:** Core's [`requires()`](/custom-routes#api-key-permissions) checks that the key's policy grants the route. Only the customer key holds `checkout`, for example.
2. **A route rule:** `routes` checks this user, with the request body.

Monorise doesn't tell custom routes who the user is. Instead the route takes the identity it needs from its body or path, and a route rule checks that it matches the session:

```ts
callers: {
  customer: {
    apiKey: process.env.CUSTOMER_API_KEY,
    rules: customerRules,
    routes: {
      'POST /app/checkout': ({ body }, { session }) =>
        (body as { userId?: string })?.userId === session?.userId,
      'PATCH /app/order/:id/cancel': ({ params }, context) =>
        isMyOrder({ kind: 'entity', action: 'update', entityType: 'order', entityId: params?.id }, context),
    },
  },
},
```

A `:param` segment matches one path segment and is passed as `params`, and a trailing `*` matches the rest of the path. Without a match in `routes`, or a top-level `'*'` rule, a custom route is refused.

## Keys for each kind of caller

Each kind of caller has a policy, a key mapped to it in `API_KEYS`, and a rules table. The key does as much of the work as it can; the rules add the per-user checks a policy can't express.

```ts
// monorise/api-keys.ts
export default defineApiKeyPolicies({
  customer: {
    entities: {
      [Entity.PRODUCT]: { read: '*', list: true },
      [Entity.ORDER]: { read: '*', update: ['notes'] }, // get only, no listing
      [Entity.USER]: {
        read: '*',
        update: ['displayName'],
        mutuals: { [Entity.ORDER]: 'read', [Entity.PRODUCT]: 'write' },
      },
    },
    routes: ['checkout'],
  },
  public: {
    entities: { [Entity.PRODUCT]: { read: ['name', 'price', 'photo'], list: true } },
  },
});
```

```bash
npx sst secret set API_KEYS '{"full":["admin-key"],"customer":["customer-key"],"public":["public-key"]}'
```

Pass each key to the app as its own environment variable:

```ts
const customerKey = new sst.Secret('CUSTOMER_API_KEY');
const publicKey = new sst.Secret('PUBLIC_API_KEY');

new sst.aws.Nextjs('web', {
  link: [api],
  environment: {
    API_BASE_URL: api.url,
    CUSTOMER_API_KEY: customerKey.value,
    PUBLIC_API_KEY: publicKey.value,
  },
});
```

## Other frameworks

`proxy.handle(request)` takes a web-standard `Request` and returns a `Response`. `GET` to `DELETE` are aliases of it, for Next.js route files.

```ts
// React Router framework mode: app/routes/api.core.$.ts
export const loader = ({ request }: Route.LoaderArgs) => proxy.handle(request);
export const action = ({ request }: Route.ActionArgs) => proxy.handle(request);
```

```ts
// Hono
app.all('/api/core/*', (c) => proxy.handle(c.req.raw));
```

| Option | Default | |
|---|---|---|
| `basePath` | `/api/core` | The prefix stripped before forwarding, so the route can live anywhere |
| `apiBaseUrl` | `process.env.API_BASE_URL` | Core's URL. Pass it on runtimes without `process.env` |
| `logMissingRules` | On unless `NODE_ENV` is `production` | Logs the rule to add when an operation has none |

Node-style `(req, res)` servers such as Express need an adapter to a web `Request`; Hono's Node server and React Router's Express adapter already do that.

## WebSocket tickets

The proxy doesn't forward `/ws/ticket`: Core issues tickets only to `full` keys. Mint them in their own route with [`generateWebSocketTicket`](/websocket#ticket-proxy-route), after your own check that the user may follow that entity. A more specific route, such as `app/api/core/ws/ticket/[entityType]/[entityId]/route.ts`, takes precedence over the catch-all.

## Testing rules

Rules are plain functions, so you can unit-test them directly. To test the whole table, `proxy.checkRequest(request)` runs every step except forwarding:

```ts
const result = await proxy.checkRequest(
  new Request('http://app/api/core/entity/order/o2', { headers: { cookie: aliceCookie } }),
);

expect(result.allowed).toBe(false);
```

An allowed result also has the `caller`, `session` and `operations`; a refused one has the `response`. Rules that call `context.core` still make requests, so stub `fetch` for them.

## Responses

| Status | Body | From | When |
|---|---|---|---|
| 401 | `authenticate`'s response, or `{ code: 'UNAUTHORIZED' }` | Proxy | No caller matches the request |
| 404 | `{ code: 'NOT_FOUND' }` | Proxy | A path Core doesn't serve, or outside `basePath` |
| 400 | `{ code: 'BAD_REQUEST' }` | Proxy | A body that isn't JSON, a malformed transaction, or a path with an empty segment or an encoded `/` |
| 403 | `{ code: 'FORBIDDEN', message: "No proxy rule for delete on 'order'" }` | Proxy | No rule matches an operation |
| 403 | `{ code: 'FORBIDDEN', message: "Proxy rule refused delete on 'order'" }` | Proxy | A rule didn't return `true` |
| 500 | `{ code: 'PROXY_MISCONFIGURED' }` | Proxy | The caller has no key, or Core has no URL |
| 502 | `{ code: 'BAD_GATEWAY' }` | Proxy | Core is unreachable |
| Anything else | Core's response, unchanged | Core | Including Core's own 403s, such as `FORBIDDEN_FIELDS` |

The proxy forwards only `content-type`, `accept`, `accept-language` and `x-request-id`, and sets `x-api-key` itself. Cookies, `authorization`, and any key the browser sends never reach Core.

## Moving from `proxy-request.ts`

Projects created before `createProxyHandler` have `app/api/proxy-request.ts` and `app/api/[...proxy]/route.ts`, which forward everything under `/api/*` with one key and no checks. To switch:

1. **Add `app/api/core/[...path]/route.ts`,** as in [day 0](#day-0-forward-everything). For `/api/core/*` it takes precedence over `[...proxy]`, so both can live side by side while you move.
2. **Add a ticket route** if you call `useEntityFeed` without a `ticketEndpoint`: `monorise init` now generates `app/api/core/ws/ticket/[entityType]/[entityId]/route.ts` with [`generateWebSocketTicket`](/websocket#ticket-proxy-route).
3. **Delete the two old files** once nothing else calls through them. Any other `/api/*` path they forwarded needs its own route.

Then add `authenticate`, a key per kind of caller, and rules.

## What the proxy doesn't do

- **Sign users in.** Sessions, cookies and tokens stay in your `authenticate`.
- **Rewrite responses.** Core already masks the fields the key can't read.
- **CORS.** A same-origin app doesn't need it.
- **Other services,** such as file uploads: they keep their own routes.
