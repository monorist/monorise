---
"@monorise/react": patch
"monorise": patch
---

Fix useMutuals forceFetch option being ignored after initial fetch. The useEffect guard `!isFirstFetched` prevented refetching even when `forceFetch: true` was passed. Now checks forceFetch before the isFirstFetched guard.
