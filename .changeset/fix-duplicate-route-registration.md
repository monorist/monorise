---
"@monorise/sst": patch
"monorise": patch
---

Fix duplicate `ANY /core/{proxy+}` route registration in `MonoriseCore`

Without this fix, `sst dev` fails immediately with `Component name <id>-monorise-apiRouteXxxxxx is not unique`. The previous `link` PR added a new route registration block but did not remove the existing one further down the constructor, so both ran unconditionally and produced two routes on the same path. The fix folds `args.link` into the `appHandlerLinks` array up-front and keeps a single route registration at the bottom (which already handles the optional WebSocket binding).
