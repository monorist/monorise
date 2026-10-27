---
'@monorise/core': minor
'@monorise/react': minor
'monorise': minor
---

Feature: `createMutual`, `updateMutual` and `deleteMutual` operations in `executeTransaction` (`POST /transaction`).

A link change can now commit atomically with entity changes. The motivating case is a counter that must never drop below a floor while a link is removed — e.g. a player who must always keep at least one guardian:

```ts
import { executeTransaction, transactional as tx } from 'monorise/react';

// player adjustmentConditions: { leave: { guardianCount: { $gte: 2 } } }
await executeTransaction([
  tx.adjustEntity(Entity.PLAYER, playerId, { guardianCount: -1, $condition: 'leave' }),
  tx.deleteMutual(Entity.GUARDIAN, Entity.PLAYER, guardianId, playerId),
]);
```

Previously the two writes had to be issued separately, so a failure between them, or two guardians leaving at once, could leave the counter and the links out of step. Now, if the condition fails, the transaction returns `409 TRANSACTION_FAILED`, the link is kept and the counter is untouched.

- **Same behaviour as the standalone calls.** Each operation reuses the standalone path's own preparation, so a transactional mutual validates and writes exactly what the standalone call would:
  - `MutualService.createMutual` is split into `prepareCreateMutual` (validate the payload against `mutualDataSchema`, read both entities, check no live link exists, build the records) and the commit. An `asEntity` projection is written in the same transaction, and its `afterCreateEntityHook` runs after the commit and before events are published.
  - `MutualRepository.updateMutual` is split into `prepareUpdateMutual` and the commit, with unchanged behaviour (`maxObjectUpdateLevel`, `returnUpdatedValue`, and `CONDITIONAL_CHECK_FAILED` → `MUTUAL_NOT_FOUND`). `MutualService.prepareUpdateMutual` validates the patch with the same `asEntity`-aware schema as `updateMutual`.
  - `MutualRepository.deleteMutual` builds its 10-minute soft delete through the new `prepareDeleteMutual`.
  - Each publishes the same event as its standalone call: `MUTUAL_CREATED`, `MUTUAL_UPDATED` with `updatedByAccountId`, and `MUTUAL_UPDATED` with `deletedByAccountId` for a delete.
- **Builders.** `transactional.createMutual(byEntityType, entityType, byEntityId, entityId, payload?)`, `transactional.updateMutual(byEntityType, entityType, byEntityId, entityId, payload)` and `transactional.deleteMutual(byEntityType, entityType, byEntityId, entityId)`, in both `@monorise/core` and `@monorise/react`, take the same argument order as the standalone `createMutual`, `editMutual` and `deleteMutual`.
- **Results.** Mutual entries carry the fields the standalone call returns: `byEntityType`, `byEntityId`, `mutualId`, `data`, `mutualData`, `createdAt`, `updatedAt` and `mutualUpdatedAt`. An `updateMutual` entry is read back after the commit, as `PATCH /mutual/...` is. When the same transaction also updated or adjusted a link's target entity, the entry's `data` is that entity's committed data, whatever the operation order.
- **React cache.** `executeTransaction` updates the store exactly as the standalone `createMutual`, `editMutual` and `deleteMutual` do: both sides of the link, `useMutual` for the pair, lists never fetched (created, not marked fetched), chain-query lists left alone, new Map references so subscribers re-render, and each operation's standalone loading and error key. If an `updateMutual`'s post-commit read failed, the cache is left as it was. `@monorise/react` now has a vitest suite (run from the root `npm test`) that checks each of these against the standalone actions.
- **Errors.** `MUTUAL_EXISTS` (createMutual on a linked pair) maps to `409`, and `MUTUAL_NOT_FOUND` (updateMutual or deleteMutual on an unlinked pair) to `404`, in line with the transaction endpoint's existing conflict and not-found codes. An unknown entity type is `400 INVALID_ENTITY_TYPE`, and a missing id or `updateMutual` payload `400 TRANSACTION_INVALID_OPERATION`.
- **Limits.** Each mutual operation uses 3 of DynamoDB's 100 transaction items (plus the projection's items for an `asEntity` mutual). A transaction can't touch the same record twice, so one link can be changed only once per transaction (`TRANSACTION_VALIDATION_ERROR`). A `createMutual` reads both entities before the commit, so it can't link to an entity created in the same transaction.

Two fixes in `@monorise/react` alongside:

- **Transactions linking one entity to different targets no longer share an in-flight request.** The transaction call key is derived from its operations, and identically shaped batches still share one request. A `createMutual`'s loading key leaves out the target id, as the standalone `createMutual`'s does, so its share of the call key now includes it. Without that, a second transaction linking the same entity to another target was handed the first one's response and never sent.
- **The standalone `deleteMutual` no longer reports a successful delete as failed when the by-side list was never fetched.** It updated `state.mutual[bySide]` without checking that the list existed.

`TransactionService` takes `MutualService` as a new, optional, last constructor argument. `DependencyContainer` passes it, and a service built without it rejects mutual operations with `TRANSACTION_INVALID_OPERATION`, so existing direct constructions keep working.
