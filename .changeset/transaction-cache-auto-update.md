---
"@monorise/core": minor
"@monorise/react": minor
"monorise": minor
---

Add an `executeTransaction` action to `@monorise/react` that auto-updates the local cache from `coreService.executeTransaction`'s result, matching the cache guarantees `createEntity`/`editEntity`/`adjustEntity`/`deleteEntity` already give a single-entity call.

Previously, `coreService.transaction` (the atomic multi-entity write backed by `TransactionService.executeTransaction`) had no action-layer wrapper — a transactional write left the local store untouched, forcing callers to hand-roll cache patching or force a refetch. The new `executeTransaction` action folds each result entry back into the store: entity `dataMap`, mutual lists, and tag slices.

Along the way:
- Renames the client-side service method from `transaction` to `executeTransaction`, matching `TransactionService.executeTransaction`'s own name and this codebase's verb-first action convention (`createEntity`, `editEntity`, ...).
- Fixes `core.service.ts`'s call using a hardcoded `requestKey: 'transaction'`, which let concurrent calls collide on one shared loading/error slot. Every transaction operation already carries a real, deterministic key via the same convention `createEntity`/`editEntity`/`adjustEntity`/`deleteEntity` use (`getEntityRequestKey(mode, entityType, entityId)`), so there's never a need to invent one — a new shared `getTransactionOperationRequestKey` helper (`helpers/transactional.ts`) derives it per operation, for both the underlying HTTP call's own key and each operation's individual loading/error signal (so a component checking a specific entity via `useLoadStore`/`getError` sees "mutating" during a transaction exactly as it would during a standalone call on that entity).
- Extracts `createEntity`'s mutual-store population into a shared `populateMutualsForCreatedEntity` helper, so an entity created via `executeTransaction` also appears in already-loaded mutual lists — previously only the standalone `createEntity` action did this.
- Extends `TransactionResultEntry` (`@monorise/core`) with optional `createdAt`/`updatedAt`, populated in `TransactionService`'s `processOperation`, so the client can build a proper `CreatedEntity`-shaped cache row for `createEntity` results and bump timestamps for `updateEntity`/`adjustEntity` results.
