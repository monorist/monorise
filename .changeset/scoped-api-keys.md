---
"@monorise/base": minor
"@monorise/cli": minor
"@monorise/core": minor
"monorise": minor
---

API keys now resolve to a policy, and projects can declare their own policies.

`API_KEYS` still accepts an array of keys, and every key in it gets the built-in `full` policy: the same access as before. It now also accepts an object that maps policy names to keys. Several keys per policy can overlap during rotation:

```json
{ "full": ["proxy-key"], "reporting": ["reporting-key"] }
```

An entry written as `sha256:<hex>` is a pre-hashed key, so the secret doesn't have to hold the key itself. A key under a policy name that isn't defined, or listed under more than one policy, is rejected with a 401 and logged as an error.

Policies are declared with `defineApiKeyPolicies` from `@monorise/base`, in a file that the new `apiKeys` option in `monorise.config.ts` points to:

```ts
// monorise.config.ts
export default {
  configDir: './monorise/configs',
  apiKeys: './monorise/api-keys',
};

// monorise/api-keys.ts
export default defineApiKeyPolicies({
  reporting: 'read',
  client: {
    entities: {
      [Entity.ORDER]: { read: '*', create: ['customerId', 'items'], update: ['status'] },
      [Entity.PRODUCT]: 'read',
    },
  },
});
```

`monorise dev` and `monorise build` validate the policies against the entity configs and fail on an unknown entity, field, tag or relationship target, on a create grant that leaves out a required field, and on redefining `full`. The API handler runs the same validation at cold start. The policies are imported only by the generated `handle.ts`, so a policy file can import the generated `Entity` enum.

Every built-in route checks the key's policy before it runs:

- A route on an entity type the policy doesn't list answers 404 `NOT_FOUND`, the same as for a type that doesn't exist. A listed type without the action answers 403 `FORBIDDEN`.
- `PUT /entity/:type/:id` (upsert) needs both create and update, since it can do either.
- `POST /transaction` checks every operation before any runs. If the key can't perform one, the whole transaction is rejected with that operation's `operationIndex`.
- `POST /ws/ticket` accepts only `full` keys, because a ticket's feed isn't scoped yet.

Relationships are granted per direction, under the first entity in the URL. `entities[Entity.LEARNER].mutuals[Entity.COURSE]` governs `/mutual/learner/:id/course` (the courses a learner applied to), never `/mutual/course/:id/learner`.

- **No entry:** the direction takes its level from how the first entity is written. A shorthand string gives its own level; an object gives its `mutuals['*']`, or none.
- **One grant for every write path:** `/mutual` routes, transaction mutual operations, and relationship fields in entity payloads. Create needs create on the direction. Update needs create and delete, since the new list replaces the old one.
- **`asEntity`:** creating a relationship whose mutual config uses `asEntity` also needs create on that entity type.
- **Chain queries** check every hop.

Writes are checked field by field. The following may only set fields in the matching create or update list:
- a create, update or upsert body;
- an adjustment;
- a relationship's `mutualData`.

Otherwise the request is rejected with 403 `FORBIDDEN_FIELDS`, listing the offending `fields`, and nothing is written. An upsert must satisfy both lists.

- **System fields:** a create body that sets `entityId` or `createdAt` needs `$entityId` or `$createdAt` in the create list. So does an upsert, because its URL chooses the ID. A `'*'` list allows every field, system fields included.
- **Legacy `$where`:** it may only name fields the key can read.

Keys on `full`, which includes every key in the array form, pass every check, so existing projects see no change.

Fixes unique-field lookups matching entity types by prefix. `GET /entity/user/unique/email/…` could return a `user-profile` entity with that email, and creating a `user` was rejected when a `user-profile` already used the value.

Custom routes declare the permission they require with `requires()` from `@monorise/core`, and a policy grants it by name in `routes`:

```ts
app.post('/checkout', requires('checkout'), handler);
app.use('/reports/*', requires('reports'));

// monorise/api-keys.ts
client: { entities: { ... }, routes: ['checkout'] },
```

A custom route without `requires()` is callable only by `full` keys. Existing custom routes keep working for existing keys, which are all `full`, and stay closed to scoped ones. `full` holds every permission. The CLI types `requires()` with the names the policies grant, so a misspelled name fails to compile.

Inside a route, `c.get('apiKey')` returns the resolved key:
- `policy`: the policy name.
- `fingerprint`: the key's SHA-256 digest, safe to log.
- `can(action, entityType, fields?)` and `has(permission)`: for finer checks.
- `access`: the compiled policy.

Also removes a check meant to let `/core/public/*` through without a key. It compared the full request URL against a path-only pattern, so it never matched: every route already required a key, and still does.
