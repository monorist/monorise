---
"@monorise/react": patch
"monorise": patch
---

Fix forceFetch option being ignored in useMutuals and useEntities hooks.

- `useMutuals`: The useEffect guard `!isFirstFetched` prevented refetching even when `forceFetch: true` was passed. Now checks `!isFirstFetched || opts?.forceFetch`.
- `useMutuals`: Added `refetch()` method to match useEntity, useEntities, and useTaggedEntities.
- `useEntities`: Same `!isFirstFetched` guard fix — now honors `forceFetch` option.
