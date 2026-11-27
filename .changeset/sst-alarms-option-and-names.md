---
"@monorise/sst": minor
"monorise": minor
---

`alarms: false` turns off Core's CloudWatch alarms: one per dead-letter queue, one for search reindex errors, and four for analytics delivery. They're on by default; AWS bills each alarm, so stages nobody watches can use `alarms: $app.stage === 'production'`. The alarm topic is still created.

Names that didn't match the rest:

- **DLQ alarms** are named after their queue, `<dlq name>-alarm`, so Core's are `shop-prod-core-mutual-dlq-alarm` instead of `shop-prod-mutual-dlq-alarm`. A `QFunction` with default names keeps `shop-prod-send-email-dlq-alarm`.
- **The replicator** is `shop-prod-core-replicator`, not `shop-prod-core-core-replicator`.
- **The API access-log groups** are `/aws/vendedlogs/apis/shop-prod-core-api` and `…-core-websocket` on new stages. Existing stages keep theirs, and their logs.
- **The analytics alarms** include the app and stage, `shop-prod-core-analytics-dlq` instead of `core-analytics-dlq`. Two stages with analytics in one account and region were overwriting each other's alarms.

On existing stages, the renamed alarms and the replicator function are replaced on the next deploy.
