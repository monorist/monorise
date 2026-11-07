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

Custom routes can read the resolved key with `c.get('apiKey')`, which returns `{ policy, fingerprint }`. The fingerprint is the key's SHA-256 digest, so it is safe to log.

Also removes a check meant to let `/core/public/*` through without a key. It compared the full request URL against a path-only pattern, so it never matched: every route already required a key, and still does.
