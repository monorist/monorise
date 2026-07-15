---
"@monorise/sst": minor
---

`SingleTable`/`MonoriseCore` now always use `expiresAt` as the DynamoDB TTL attribute name and no longer accept `ttl`/`tableTtl` args. This was previously user-configurable, but the codebase already hardcodes `expiresAt` internally (mutual/tag locks, and now entity TTL), so a mismatched or unset value silently left TTL disabled.

Remove `ttl`/`tableTtl` from your sst config — the table will always use `expiresAt`. If you're importing an existing table via `fromTableName`, make sure its TTL attribute is named `expiresAt`.
