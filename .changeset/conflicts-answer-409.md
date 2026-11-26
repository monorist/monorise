---
"@monorise/core": major
"monorise": major
---

Conflicts answer 409 everywhere.

- **Breaking:** a taken unique value (`UNIQUE_VALUE_EXISTS`) on create, update or upsert answers `409`, as it already did in transactions. It was `400` on create and update, and an unhandled `500` on upsert.
- When DynamoDB cancels a write because another request wrote the same items at the same time, such as two creates claiming one unique value, Core answers `409 TRANSACTION_CONFLICT` instead of a `500`. Retrying is safe. This covers entity creates and updates, and relationship writes.
