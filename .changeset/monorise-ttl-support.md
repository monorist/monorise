---
"monorise": minor
---

Add `ttl` config to `createEntityConfig` for setting a DynamoDB TTL on an entity (see `@monorise/base`/`@monorise/core` changes). Also, `monorise/sst`'s `SingleTable`/`MonoriseCore` now always use `expiresAt` as the DynamoDB TTL attribute and no longer accept `ttl`/`tableTtl` args — remove those from your sst config.

Also fixes two related bugs: `Mutual#expiresAt` now returns epoch seconds instead of an ISO string (DynamoDB TTL requires epoch seconds), and `upsertEntity` no longer throws when called with an `entityId` that hasn't been created yet — it now falls back to creating the entity.
