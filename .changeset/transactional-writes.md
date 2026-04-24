---
'@monorise/core': minor
'@monorise/react': minor
'monorise': minor
---

Add transactional writes for atomic multi-entity operations

- `POST /core/transaction` endpoint for atomic multi-entity operations
- Supports createEntity, updateEntity, adjustEntity, deleteEntity in single DynamoDB TransactWriteItems call
- All-or-nothing: if any operation fails, entire transaction rolls back
- Events (ENTITY_CREATED, ENTITY_UPDATED, ENTITY_DELETED) published only after commit succeeds
- Condition support: adjustmentConditions and updateConditions work within transactions
- React SDK: `transaction()` function for frontend usage
- DynamoDB limit enforced: max 100 items per transaction
