---
"@monorise/base": minor
"@monorise/core": minor
---

Add `ttl` config to `createEntityConfig` for setting a DynamoDB TTL on an entity. Define `ttl.processor` to compute `expiresAt` (epoch seconds or a `Date`) from the entity's data; it's recomputed on every create/update/upsert. Returning `undefined` means no expiry for that record.
