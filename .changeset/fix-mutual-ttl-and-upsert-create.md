---
"@monorise/core": patch
---

Fix two bugs found while adding entity TTL support:

- `Mutual#expiresAt` was stored/read as an ISO string, which DynamoDB TTL can't act on (it requires epoch seconds, type `N`). It's now epoch seconds, consistent with `Entity#expiresAt` and the raw lock-writing paths in `Mutual.ts`/`Tag.ts`.
- `upsertEntity` threw a DynamoDB validation error when called with an `entityId` that had never been created, because the nested `data.<field>` update path requires `data` to already exist as a Map. It now falls back to creating the entity fresh when the update finds nothing to update.
