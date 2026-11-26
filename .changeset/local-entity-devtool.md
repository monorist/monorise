---
"@monorise/cli": minor
"@monorise/sst": minor
"monorise": minor
---

Add `monorise devtool`, a local entity dashboard that discovers project entity
configs and supports listing, pagination, configured search, create, update,
and delete operations. Browse configured tag indexes with group, prefix, and
range filters, and inspect an entity's mutual relationships in either direction.
Mutual relationships can be created, updated, and deleted with schema-aware
mutual data templates. Entity schema references identify unique fields and
scroll independently from the JSON editor. API requests pass through a
restricted local proxy so configured API keys remain in the Node process
instead of the browser. Discover deployed SST stages and their Monorise API
Gateway URLs, and switch between each stage's scoped API keys by policy and
fingerprint. The devtool defaults to the browser-safe port `6767`.
