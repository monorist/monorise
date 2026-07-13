---
"@monorise/react": patch
"monorise": patch
---

Fix `editEntity` and `adjustEntity` so they re-bucket an entity across already-loaded tag slices instead of only patching its data in place. Previously, changing a field that a tag's `processor` derives its `group`/`sortValue` from (e.g. an anomaly's `status`) left the entity sitting in its old tag group with stale membership — so `useTaggedEntities` kept showing, say, a `resolved` item in the `open` list until the backend tag processor caught up and a refetch ran. Both actions now run each tag's `processor` against the updated data and, per loaded slice, keep/add the entity where it now matches and remove it where it no longer does (mirroring the add-only matcher already used by `createEntity`, extended with delete-on-mismatch). Query-filtered slices, which can't be evaluated client-side, still only patch an existing member in place.
