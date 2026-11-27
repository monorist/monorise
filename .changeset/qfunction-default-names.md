---
"@monorise/sst": minor
"monorise": minor
---

`QFunction` names its resources the way Core does: `new QFunction('send-email', …)` in app `shop` on stage `prod` creates `shop-prod-send-email-queue`, `shop-prod-send-email-dlq` and `shop-prod-send-email-processor`. Pass `name`, `queueName` or `dlqName` to choose your own. A default name longer than AWS allows (64 characters for a function, 80 for a queue) falls back to SST's generated name.

A `QFunction` deployed before this had generated names. On its next deploy, its queues and function are replaced under the new names. Messages still in the old queues are deleted with them, so redrive or clear the dead-letter queue first. The function keeps logging to its existing log group.

The SST docs gain "Naming your own resources", on naming the other SST components an app adds, and what to check before renaming one that already exists.
