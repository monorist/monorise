---
"@monorise/react": patch
"monorise": patch
---

Fix `useEntities` so that content-only edits propagate to the local `entities` snapshot. Previously the effect only called `setEntities` when `dataMap.size !== entities?.length`, so an edit that mutated an entity in place (same id, new field values) was silently ignored and the consumer kept rendering stale data until a full reload. The comparison now also walks `dataMap` and falls back to a JSON content compare, matching the existing behavior of `useMutuals`.
