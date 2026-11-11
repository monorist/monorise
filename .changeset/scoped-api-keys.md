---
"@monorise/base": minor
"@monorise/cli": minor
"@monorise/core": minor
"monorise": minor
---

Scoped API keys: every API key now resolves to a policy that decides which entity types, fields, relationships and custom routes it can read or write. See the new [API Keys](https://monorise.dev/api-keys) guide.

**Nothing changes for existing projects.** `API_KEYS` still accepts an array of keys, and every key in it gets the built-in `full` policy, the same access as before. `full` passes every check below and pays nothing extra.

### Declaring policies

Point the new `apiKeys` option in `monorise.config.ts` at a file that default-exports `defineApiKeyPolicies` from `@monorise/base`. Then map policy names to keys with the object form of `API_KEYS`:

```ts
// monorise.config.ts
export default {
  configDir: './monorise/configs',
  apiKeys: './monorise/api-keys',
};

// monorise/api-keys.ts
export default defineApiKeyPolicies({
  'agent-read': 'read',
  client: {
    entities: {
      [Entity.ORDER]: { read: '*', list: true, create: ['customerId', 'items'], update: ['status'] },
      [Entity.LEARNER]: {
        read: '*',
        mutuals: { [Entity.COURSE]: { read: '*', create: ['role'], delete: true } },
      },
      [Entity.PRODUCT]: 'read',
    },
    routes: ['checkout'],
  },
});
```

```json
{ "full": ["proxy-key"], "client": ["client-key"], "agent-read": ["agent-key"] }
```

- **Shorthands are broad, objects are exact.** `'read'` and `'write'` grant every field, tag and relationship at that level, listing included. An object grants only what it lists. Any write implies read on the same fields.
- **Get and list are separate.** `read` allows getting a record by ID or unique field. Listing the whole type, searching and querying tags also need `list: true`. A get needs a reference the caller already holds; a listing pages through every record.
- **Relationships are granted per direction**, keyed under the first entity in the URL. An entry for learner→course says nothing about course→learner.
- **Pre-hashed keys.** An `API_KEYS` entry written as `sha256:<hex>` lets the secret hold a digest instead of the key.
- **Fails closed.** A key under an undefined policy, or under more than one policy, is rejected with a 401 and logged.
- **Typed names.** Entity field names, tag names and `mutualData` field names are typed from the configs the CLI generates.
- **Validated at build and at start.** `monorise dev` and `monorise build` reject unknown entities, fields, tags and relationship targets, create grants that leave out a required field, and a policy file inside `configDir`. The API handler repeats the check at cold start. If it fails, the handler logs the problems and rejects every key under the project's policies, while `full` keys and the processors keep running.

### What a scoped key can do

- **Entity types:** a type the policy doesn't list answers 404, the same as a type that doesn't exist. A listed type without the action answers 403 `FORBIDDEN`. Upsert needs both create and update.
- **Field-level writes:** create, update and upsert bodies, adjustments and `mutualData` may only set fields in the matching list. Otherwise the request is rejected with 403 `FORBIDDEN_FIELDS` and the `fields` it named, and nothing is written.
  - Setting `entityId` or `createdAt` needs `$entityId` or `$createdAt` in the create list, as does an upsert.
  - A legacy `$where` may only name readable fields.
- **Relationship fields** in entity payloads check their direction: create needs create; update needs create and delete. Creating an `asEntity` relationship also needs create on that entity type.
- **Masked reads:** responses leave out the fields the key can't read. That covers entities, lists, tags, relationship `data` and `mutualData`, transaction results, and the entity a write returns.
- **Field-matching requests:**
  - search needs `list` and read on every searchable field;
  - a unique lookup needs read on its field;
  - a tag needs `list`, plus `read: '*'` or an explicit `tags` grant.
- **Transactions** are checked operation by operation before anything runs. One forbidden operation rejects the whole transaction, with its `operationIndex`.
- **WebSocket:** `POST /ws/ticket` accepts only `full` keys, because ticket feeds aren't scoped yet.

### Custom routes

Custom routes declare the permission they need with `requires()` from `@monorise/core`, per route or on a group. A policy grants permissions by name in `routes`:

```ts
app.post('/checkout', requires('checkout'), handler);
app.use('/reports/*', requires('reports'));
```

- **No `requires()`, `full` only.** Existing custom routes keep working for existing keys and stay closed to scoped ones.
- **Typed names.** The CLI types `requires()` with the names the policies grant.
- **The resolved key.** Inside a route, `c.get('apiKey')` returns:
  - `policy` and `fingerprint` (the key's SHA-256 digest, safe to log);
  - `can(action, entityType, fields?)` and `has(permission)`;
  - `mask(entityType, entity)`.

### Tracing changes

Every event published while handling an API request records the calling key in its detail, as `apiKey: { policy, fingerprint }`. That includes writes custom routes make through `container` services. Events from processors carry no key. Error logs include the policy name.

### Also

- **Unique-lookup fix.** Unique-field lookups matched entity types by prefix, so `GET /entity/user/unique/email/…` could return a `user-profile` entity, and creating a `user` was rejected when a `user-profile` already used the value. Both now match the type exactly.
- **Dead check removed.** A check meant to let `/core/public/*` through without a key never matched: every route already required a key, and still does.
- **`monorise init` template.** The Next.js proxy now reads its key from `MONORISE_API_KEY`, set from the `X_API_KEY` secret in `sst.config.ts`, so each additional app can pass its own key without editing the proxy.
