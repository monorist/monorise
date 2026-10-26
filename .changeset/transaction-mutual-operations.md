---
'@monorise/core': minor
'@monorise/react': minor
'monorise': minor
---

Feature: `createMutual` and `deleteMutual` operations in `executeTransaction` (`POST /transaction`).

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

- **Same behaviour as the standalone calls.** `MutualService.createMutual` is split into `prepareCreateMutual` (validate the payload against `mutualDataSchema`, read both entities, check no live link exists, build the records) and the commit. The transaction reuses `prepareCreateMutual`, so a transactional mutual stores the same three records, including an `asEntity` projection, whose `afterCreateEntityHook` runs after the commit and before events are published. `deleteMutual` uses the new `MutualRepository.prepareDeleteMutual`, which builds the same 10-minute soft delete that `deleteMutual` writes. Both publish the same events as the standalone calls: `MUTUAL_CREATED`, and `MUTUAL_UPDATED` with `deletedByAccountId` for a delete.
- **Builders.** `transactional.createMutual(byEntityType, entityType, byEntityId, entityId, payload?)` and `transactional.deleteMutual(byEntityType, entityType, byEntityId, entityId)`, in both `@monorise/core` and `@monorise/react`, take the same argument order as the standalone actions.
- **Results.** Mutual entries in the transaction result carry `byEntityType`, `byEntityId`, `mutualId`, `mutualData` and `mutualUpdatedAt`, alongside the existing fields. The React `executeTransaction` action updates both sides of any loaded `useMutuals` lists from them, the same as the standalone `createMutual`/`deleteMutual` do.
- **Errors.** `MUTUAL_EXISTS` (createMutual on a linked pair) maps to `409`, and `MUTUAL_NOT_FOUND` (deleteMutual on an unlinked pair) to `404`, in line with the transaction endpoint's existing conflict and not-found codes. An unknown entity type is `400 INVALID_ENTITY_TYPE`, and a missing id `400 TRANSACTION_INVALID_OPERATION`.
- **Limits.** Each mutual operation uses 3 of DynamoDB's 100 transaction items (plus the projection's items for an `asEntity` mutual). A transaction can't touch the same record twice, so creating and deleting the same link in one transaction is rejected as `TRANSACTION_VALIDATION_ERROR`.

`TransactionService` takes `MutualService` as a new, optional, last constructor argument. `DependencyContainer` passes it, and a service built without it rejects mutual operations with `TRANSACTION_INVALID_OPERATION`, so existing direct constructions keep working.
