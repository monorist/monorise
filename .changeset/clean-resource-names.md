---
"@monorise/sst": minor
"monorise": minor
---

Core's table and queues get readable names that share its functions' prefix, `<stage>-<app>-<id>`: `prod-shop-core-table`, `prod-shop-core-mutual-queue`, `prod-shop-core-mutual-dlq`, `prod-shop-core-replicator-dlq`, instead of names such as `shop-prod-corecoretableTable-abcdefgh`.

- **New stages** get the new names.
- **Existing stages keep their table.** AWS can't rename a table, and a new name would replace it with an empty one.
- **Existing stages' queues are replaced** with new ones under the new names on the next deploy. Messages still in the old queues are deleted with them: redrive or clear the dead-letter queues first, and deploy while the app is quiet.

`QFunction` accepts `queueName` and `dlqName`. Without them, its queues keep SST's generated names.
