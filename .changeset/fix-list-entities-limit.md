---
"@monorise/react": patch
"@monorise/core": patch
"monorise": patch
---

Fix limit param in listEntities and useEntities - limit was not passed through from params, always defaulting to 20. Also fix NaN limit in list-entities controller when limit query param is not provided.
