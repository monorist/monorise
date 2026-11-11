# API Keys

Every request to Monorise Core carries an API key in the `x-api-key` header, and every key resolves to a **policy**. A policy decides which entity types, fields, relationships and custom routes the key can read or write.

Out of the box, every key gets the built-in `full` policy: everything, as before. Scoping is opt-in, one key at a time.

## Day 0: one key that does everything

`API_KEYS` is an array of keys, and each one gets `full`:

```bash
npx sst secret set API_KEYS '["secret1", "secret2"]'
```

That's the default for local development, and nothing else needs configuring. Upgrading Monorise never changes what an array key can do.

## Declaring policies

Point `apiKeys` in `monorise.config.ts` at a file that default-exports `defineApiKeyPolicies(...)`:

```ts
// monorise.config.ts
export default {
  configDir: './monorise/configs',
  customRoutes: './services/core/routes',
  apiKeys: './monorise/api-keys',
};
```

```ts
// monorise/api-keys.ts
import { defineApiKeyPolicies } from 'monorise/base';
import { Entity } from '#/monorise';

export default defineApiKeyPolicies({
  // Read everything, write nothing: for debugging, reporting, agents
  'agent-read': 'read',

  // A customer-facing app
  client: {
    entities: {
      [Entity.ORDER]: {
        read: '*',
        create: ['customerId', 'items', 'notes'],
        update: ['status', 'notes'], // customerId is fixed once created
      },
      [Entity.PRODUCT]: 'read',
      [Entity.USER]: {
        read: ['displayName'],
        write: ['displayName'],
        mutuals: {
          [Entity.PRODUCT]: { read: '*', create: '*', delete: true }, // wishlist
        },
      },
    },
    routes: ['checkout'],
  },

  // Read everything except sensitive data
  support: {
    entities: {
      '*': 'read',
      [Entity.USER]: { read: ['displayName', 'status'] },
      [Entity.PAYMENT]: 'none',
    },
  },
});
```

Then map key values to policy names. Use the object form of `API_KEYS`:

```bash
npx sst secret set API_KEYS '{"full":["admin-key"],"client":["client-key"],"agent-read":["agent-key"]}'
```

`monorise dev` and `monorise build` check the policies against your entity configs, and `monorise dev` checks them again each time you save the policy file. They fail the build on an unknown entity, field, tag or relationship target, or on a create grant that leaves out a required field. The API checks them again at cold start. If that check fails, it logs the problems and rejects every key under your policies; `full` keys keep working.

::: warning
Keep the policy file outside `configDir`. The CLI loads every file there as an entity config, so it rejects a policy file in that directory.
:::

## What a policy grants

### Shorthands are broad, objects are exact

| Written as | Grants |
|---|---|
| `'read'` | Every field and tag, and read on every relationship from this entity |
| `'write'` | Read, create, update and delete on every field, and write on every relationship from this entity |
| `'none'`, or not listed | Nothing. Requests on the type answer 404, as if it didn't exist |
| `{ ... }` | Only what the object lists |

At the policy level, `'read'` and `'write'` apply to every entity. `entities['*']` sets a default for every entity a policy doesn't list.

### Entity grants

| Key | Meaning |
|---|---|
| `read` | `'*'` or the fields the key can read |
| `create` | Fields a create may set. Must include every field `createSchema` requires |
| `update` | Fields an update may set |
| `write` | Shorthand for the same list in `create` and `update` |
| `delete` | `true` to allow delete |
| `tags` | Tags the key can query. Defaults to every tag when `read` is `'*'`, otherwise none |
| `mutuals` | Relationships from this entity; see below |

- **Any write implies read** on the same fields.
- **Field lists are allowlists**, so a field you add to an entity later stays hidden from scoped keys until you grant it.
- **Choosing the ID or the timestamp:** a create body may set `entityId` or `createdAt` only if the create list names `$entityId` or `$createdAt`. So may an upsert, because its URL chooses the ID. A `'*'` list allows both.

### Relationships

Relationships are granted per direction, under the first entity in the URL. `/mutual/learner/:id/course` (the courses a learner applied to) and `/mutual/course/:id/learner` (the learners who applied to a course) are separate grants. An entry for one is never applied to the other.

```ts
[Entity.LEARNER]: {
  read: '*',
  mutuals: {
    // learner→course: list, apply and withdraw; set `role` when applying
    [Entity.COURSE]: { read: '*', create: ['role'], delete: true },
  },
},
[Entity.COURSE]: { read: '*' }, // course→learner: not granted
```

A direction's field lists name `mutualData` fields.

When a direction has no entry, how the first entity in the URL is written decides it:

| Course written as | `GET /mutual/course/9/learner` | `POST /mutual/course/9/learner/1` |
|---|---|---|
| `'read'` | 200 | 403 |
| `'write'` | 200 | 200 |
| an object, e.g. `{ read: '*' }` | 403 | 403 |
| an object with `mutuals: { '*': 'read' }` | 200 | 403 |
| `'none'`, or not listed | 404 | 404 |

To allowlist strictly, write every entity as an object and list each direction.

The same direction grant applies on every path that writes a relationship:
- the `/mutual` routes;
- transaction mutual operations;
- relationship fields such as `courseIds` in an entity payload. On create they need create on the direction. On update they need create and delete, because the new list replaces the old one.

Creating a relationship whose mutual config uses `asEntity` also needs create on that entity type. So does a request that names a type with `?asEntity=`.

## What a scoped key sees

- **Writes are checked field by field.** A body that sets a field outside the key's list is rejected with `FORBIDDEN_FIELDS`, and nothing is written.
- **Responses are masked.** Fields the key can't read are left out of entities, lists, tags, relationships and transaction results.
- **Requests that match on a field need read on it:**
  - search (`?query=`) needs read on every searchable field;
  - a unique lookup needs read on the field it looks up by;
  - a tag needs `read: '*'` on the type or an explicit `tags` grant.
- **WebSocket tickets** (`POST /ws/ticket`) are for `full` keys only, because a ticket's feed isn't scoped.

| Response | When |
|---|---|
| 401 | Missing or unknown key |
| 404 `NOT_FOUND` | The entity type isn't in the key's policy |
| 403 `FORBIDDEN` | The type is listed, but the action, direction, tag or route isn't granted |
| 403 `FORBIDDEN_FIELDS` | A write sets, or a request matches on, fields outside the key's lists. `fields` names them |

A transaction is checked operation by operation before anything runs. A forbidden operation rejects the whole transaction, and the response includes its `operationIndex`.

One side channel stays open, by design: a named `$condition` on an update or adjustment can succeed or fail (200 or 409) depending on fields the key can't read. Conditions are defined in the entity config, not by the caller, so what they can reveal is limited to what you wrote into them.

## Custom routes

Custom routes declare the permission they need with `requires()`, and a policy grants it in `routes`. A custom route without `requires()` is callable only by `full` keys. See [Custom Routes](/custom-routes#api-key-permissions).

## Tracing changes to a key

Every event Monorise Core publishes while handling an API request records the key that made it, in the event detail:

```json
{ "entityType": "order", "entityId": "…", "apiKey": { "policy": "client", "fingerprint": "9f86d081…" } }
```

- **Custom routes are covered too.** Writes they make through `container` services publish their events with the calling key.
- **Processor events carry no `apiKey`**, because that work is the system's own.
- **Error logs** (`INTERNAL_SERVER_EXCEPTION`) include the policy name.

The fingerprint is the key's SHA-256 digest. It tells you which key made a change without revealing it, and to match it against a key you hold:

```bash
printf '%s' "$KEY" | shasum -a 256
```

## Rotating and hashing keys

Each policy maps to an array, so old and new keys can overlap during [rotation](/deploying#key-rotation-without-downtime).

To keep the keys themselves out of the secret, store their SHA-256 digests instead:

```bash
npx sst secret set API_KEYS '{"client":["sha256:9f86d08188…"]}'
```

The digest is the 64-character hex SHA-256 of the key, e.g. from `printf '%s' "$KEY" | shasum -a 256`. Clients still send the key itself. Hashing is per key, so plain keys and digests can sit in the same list.

A key listed under a policy that isn't defined, under more than one policy, or as a `sha256:` entry that isn't a 64-character hex digest, is rejected with a 401 and logged as an error. The other keys keep working.

## Several apps, one API

Policies are roles, and keys are credentials. Give each app its own key value, even when two apps share a policy, so you can rotate or revoke one app on its own.

Every app sends the same `x-api-key` header. One SST secret has a single value per stage, so each app needs its own secret. Pass it under the same environment variable, so the proxy code is identical in every app:

```ts
const adminKey = new sst.Secret('ADMIN_API_KEY', 'secret1');
const clientKey = new sst.Secret('CLIENT_API_KEY', 'secret2');

new sst.aws.Nextjs('admin', {
  path: 'apps/admin',
  link: [api],
  environment: { API_BASE_URL: api.url, MONORISE_API_KEY: adminKey.value },
});
new sst.aws.Nextjs('client', {
  path: 'apps/client',
  link: [api],
  environment: { API_BASE_URL: api.url, MONORISE_API_KEY: clientKey.value },
});
```

::: tip
A key identifies the calling server, not the end user. Monorise does no user authentication. Rules like "a user only sees their own orders" belong in your proxy or in custom routes.
:::
