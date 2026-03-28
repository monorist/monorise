---
"@monorise/react": patch
"monorise": patch
---

Add limit param support to useEntities, with useState for stable tracking. Default params to { limit: 20 }. listMore respects the same limit. Add limit to CommonOptions for useMutuals and listMoreEntities.
