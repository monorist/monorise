# monorise

## 0.0.2

### Patch Changes

- 7a29b6a: Auto-populate mutual store on createEntity so useMutuals reflects new entities without refresh
- 7a29b6a: Fix forceFetch option being ignored in useMutuals and useEntities hooks.

  - `useMutuals`: The useEffect guard `!isFirstFetched` prevented refetching even when `forceFetch: true` was passed. Now checks `!isFirstFetched || opts?.forceFetch`.
  - `useMutuals`: Added `refetch()` method to match useEntity, useEntities, and useTaggedEntities.
  - `useEntities`: Same `!isFirstFetched` guard fix — now honors `forceFetch` option.

- 7a29b6a: Fix tag processor type inference to use baseSchema shape instead of CreatedEntity<T>
- 7a29b6a: Add module augmentation for monorise/base combined package to fix type resolution
- 7a29b6a: Auto-propagate entity state to mutual and tag stores on create, edit, and delete
- 7a29b6a: Rewrite @monorise/\* imports to relative paths in combined package .d.ts files to fix type resolution

## 0.0.2

### Patch Changes

- 348c835: Add typesVersions field to fix TypeScript type resolution for subpath imports

## 0.0.1

### Patch Changes

- 5e8d320: Unified monorise package
