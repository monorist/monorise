---
"@monorise/sst": minor
"monorise": minor
---

Core's resources share one prefix, `<app>-<stage>-<id>`, app first as in SST's generated names, so a stage's resources sort together: `shop-prod-core-table`, `shop-prod-core-mutual-queue`, `shop-prod-core-mutual-dlq`, `shop-prod-core-replicator-dlq`, `shop-prod-core-app-handler`. Before, the table and queues had generated names such as `shop-prod-corecoretableTable-abcdefgh`, and the functions were named `prod-shop-core-…`.

- **New stages** get the new names.
- **Existing stages keep their table.** AWS can't rename a table, and a new name would replace it with an empty one.
- **Existing stages' queues are replaced** with new ones under the new names on the next deploy. Messages still in the old queues are deleted with them: redrive or clear the dead-letter queues first, and deploy while the app is quiet.
- **Existing stages' functions are replaced** under the new names, and keep logging to their existing log groups. If an entity uses `search`, the search index is rebuilt once. Core's dashboard and `QFunction`'s DLQ alarm are renamed the same way.

`QFunction` accepts `queueName` and `dlqName`. Without them, its queues keep SST's generated names.
