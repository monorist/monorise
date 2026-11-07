---
"@monorise/core": minor
"monorise": minor
---

API keys now resolve to a policy.

`API_KEYS` still accepts an array of keys, and every key in it gets the built-in `full` policy: the same access as before. It now also accepts an object that maps policy names to keys. Several keys per policy can overlap during rotation:

```json
{ "full": ["key-1", "key-2"] }
```

An entry written as `sha256:<hex>` is a pre-hashed key, so the secret doesn't have to hold the key itself. A key under a policy name that isn't defined, or listed under more than one policy, is rejected with a 401 and logged as an error.

Custom routes can read the resolved key with `c.get('apiKey')`, which returns `{ policy, fingerprint }`. The fingerprint is the key's SHA-256 digest, so it is safe to log.

Also removes a check meant to let `/core/public/*` through without a key. It compared the full request URL against a path-only pattern, so it never matched: every route already required a key, and still does.
