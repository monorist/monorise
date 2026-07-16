---
'@monorise/base': minor
'@monorise/core': major
'@monorise/react': minor
'monorise': major
---

Add named conditions system for conditional entity writes

- `adjustmentConditions`: server-defined preconditions for `adjustEntity`. `$condition` required when defined. Condition functions receive `(data, adjustments)`.
- `updateConditions`: server-defined preconditions for `updateEntity`. `$condition` always optional. Condition functions receive `(data)`.
- Clients send a condition name (`$condition: 'withdraw'`), server resolves to DynamoDB ConditionExpression. Raw operators never exposed to frontend.
- Deprecates `adjustmentConstraints` (backward compatible — falls back automatically when no `adjustmentConditions` is defined).
- **Breaking (security):** raw `$where` on `updateEntity` is now rejected by default (`INVALID_CONDITION`, 400) instead of silently accepted with a warning. Opt in per entity with `allowLegacyWhere: true` (not recommended) or migrate to named `updateConditions`.
