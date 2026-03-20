# monorise

## 0.0.2-dev.5

### Patch Changes

- 5d4b618: Fix tag processor type inference to use baseSchema shape instead of CreatedEntity<T>

## 0.0.2-dev.4

### Patch Changes

- d121c21: Rewrite @monorise/\* imports to relative paths in combined package .d.ts files to fix type resolution

## 0.0.2-dev.3

### Patch Changes

- d3568d3: Fix forceFetch option being ignored in useMutuals and useEntities hooks.

  - `useMutuals`: The useEffect guard `!isFirstFetched` prevented refetching even when `forceFetch: true` was passed. Now checks `!isFirstFetched || opts?.forceFetch`.
  - `useMutuals`: Added `refetch()` method to match useEntity, useEntities, and useTaggedEntities.
  - `useEntities`: Same `!isFirstFetched` guard fix — now honors `forceFetch` option.

## 0.0.2-dev.2

### Patch Changes

- 6602dc2: Auto-populate mutual store on createEntity so useMutuals reflects new entities without refresh

## 0.0.2-dev.1

### Patch Changes

- eeb410d: Add module augmentation for monorise/base combined package to fix type resolution

## 0.0.2-dev.0

### Patch Changes

- 348c835: Add typesVersions field to fix TypeScript type resolution for subpath imports
- 9ce08cc: Auto-propagate entity state to mutual and tag stores on create, edit, and delete

## 0.0.1

### Patch Changes

- 5e8d320: Unified monorise package
