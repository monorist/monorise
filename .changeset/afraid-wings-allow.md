---
"@monorise/react": patch
---

Update:

- createEntity accepting custom `requestKey`
  - in some cases, we need to perform bulk create, where multiple requests are deduped
- expose `getEntity` from core.action
