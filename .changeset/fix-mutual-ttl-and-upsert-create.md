---
"@monorise/core": patch
---

Fix bugs found while adding entity TTL support:

- `Mutual#expiresAt` was stored/read as an ISO string, which DynamoDB TTL can't act on (it requires epoch seconds, type `N`). It's now epoch seconds, consistent with `Entity#expiresAt` and the raw lock-writing paths in `Mutual.ts`/`Tag.ts`.
- `upsertEntity` threw a DynamoDB validation error when called with an `entityId` that had never been created, because the nested `data.<field>` update path requires `data` to already exist as a Map. It now delegates to `createEntity` when the update finds nothing to update, so a brand-new entity created via `upsertEntity` gets the same `LIST#`/`UNIQUE#`/`EMAIL#` replica rows, `uniqueFields` enforcement, and typed ID-collision error as any other newly created entity (previously it would silently create an incomplete, orphaned record).
- `computeExpiresAt`'s merge-fetch swallowed any error (not just "entity not found") as if the entity didn't exist yet, so a transient DynamoDB error could silently produce a wrong `expiresAt` instead of surfacing. It now only treats the specific not-found case that way and rethrows anything else.
- `ttl.processor` was always given the current operation's timestamp as `createdAt`, never the entity's true original creation date, so a TTL relative to creation (e.g. "expire 90 days after creation") would silently drift forward on every update. It's now the real `createdAt`.
- `updateEntity` did up to 3 redundant `GetItem` reads for a single update when both `ttl` and a changed `uniqueFields` value were involved. It now shares one fetch and constructs the returned entity locally instead of re-fetching after a transactional write.
- For an entity with both `uniqueFields` and `ttl` configured, updating a unique field on an update where `ttl.processor` returns `undefined` wrote the new `UNIQUE#` replica row with no `expiresAt` and returned an entity whose `expiresAt` disagreed with what was actually persisted (the main row correctly retains its previous `expiresAt` in that case). Both now correctly carry over the previous `expiresAt`.
