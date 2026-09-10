---
"@monorise/core": minor
"@monorise/react": minor
"monorise": minor
---

Add a `transaction` action to `@monorise/react` that auto-updates the local cache from `coreService.transaction`'s result, matching the cache guarantees `createEntity`/`editEntity`/`adjustEntity`/`deleteEntity` already give a single-entity call.

Previously, `coreService.transaction` (the atomic multi-entity write backed by `TransactionService.executeTransaction`) had no action-layer wrapper — a transactional write left the local store untouched, forcing callers to hand-roll cache patching or force a refetch. The new `transaction` action folds each result entry back into the store: entity `dataMap`, mutual lists, and tag slices.

Along the way:
- Fixes `core.service.ts`'s `transaction()` using a hardcoded `requestKey: 'transaction'`, which let concurrent `transaction()` calls collide on one shared loading/error slot.
- Extracts `createEntity`'s mutual-store population into a shared `populateMutualsForCreatedEntity` helper, so an entity created via `transaction()` also appears in already-loaded mutual lists — previously only the standalone `createEntity` action did this.
- Extends `TransactionResultEntry` (`@monorise/core`) with optional `createdAt`/`updatedAt`, populated in `TransactionService`'s `processOperation`, so the client can build a proper `CreatedEntity`-shaped cache row for `createEntity` results and bump timestamps for `updateEntity`/`adjustEntity` results.
