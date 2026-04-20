---
'@monorise/base': minor
'@monorise/core': minor
'@monorise/react': minor
'monorise': minor
---

Add named conditions system for conditional entity writes

- `adjustmentConditions`: server-defined preconditions for `adjustEntity`. `$condition` required when defined. Condition functions receive `(data, adjustments)`.
- `updateConditions`: server-defined preconditions for `updateEntity`. `$condition` always optional. Condition functions receive `(data)`.
- Clients send a condition name (`$condition: 'withdraw'`), server resolves to DynamoDB ConditionExpression. Raw operators never exposed to frontend.
- Deprecates `adjustmentConstraints` (backward compatible) and raw `$where` on updateEntity (backward compatible with warning).
