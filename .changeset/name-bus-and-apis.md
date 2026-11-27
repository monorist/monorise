---
"@monorise/sst": minor
"monorise": minor
---

Core's remaining resources get readable names with the `<app>-<stage>-<id>` prefix: the API (`shop-prod-core-api`), the event bus (`shop-prod-core-bus`) and its rules (`shop-prod-core-mutual-rule`, …), the alarm topic (`shop-prod-core-alarms`), and, when enabled, the WebSocket API (`shop-prod-core-websocket`) and its functions (`shop-prod-core-ws-connect`, …).

On existing stages:
- **The APIs are renamed in place.** Their URLs don't change.
- **The bus and its rules are replaced.** Rules added to the bus outside the SST config aren't recreated.
- **The alarm topic keeps its name.** SNS can't rename a topic, and a new one would drop the subscriptions added to receive alarms.
- **The WebSocket functions are replaced** under the new names.
