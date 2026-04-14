---
"@monorise/base": minor
"@monorise/react": minor
---

Expose conditional PATCH updates via `$where` in react package

- Added `WhereOperator`, `WhereClause`, `WhereConditions` types to `@monorise/base`
- `editEntity` in `@monorise/react` now accepts an optional `where` argument; conditions are sent as `$where` in the PATCH body
- Re-exports `WhereConditions`, `WhereClause`, `WhereOperator` from `@monorise/react`
