# monorise

## 1.1.1

### Patch Changes

- a582fe6: Fix `editEntity` and `adjustEntity` so they re-bucket an entity across already-loaded tag slices instead of only patching its data in place. Previously, changing a field that a tag's `processor` derives its `group`/`sortValue` from (e.g. an anomaly's `status`) left the entity sitting in its old tag group with stale membership — so `useTaggedEntities` kept showing, say, a `resolved` item in the `open` list until the backend tag processor caught up and a refetch ran. Both actions now run each tag's `processor` against the updated data and, per loaded slice, keep/add the entity where it now matches and remove it where it no longer does (mirroring the add-only matcher already used by `createEntity`, extended with delete-on-mismatch). Query-filtered slices, which can't be evaluated client-side, still only patch an existing member in place.

  Additionally, `useTaggedEntities` now orders the loaded slice the same way the backend does — descending by the tag sort key `${sortValue}#${entityType}#${entityId}` (rebuilt client-side from the tag's `processor`, matching `ScanIndexForward:false`). Previously it returned entities in raw insertion order, so an optimistically added/updated entity appended to the end regardless of its `sortValue`. This re-orders only the loaded window; on a paginated list an item whose new `sortValue` belongs on an unfetched page may sit at the boundary until the next fetch (a per-user, self-healing approximation).

## 1.1.0

### Minor Changes

- 9d175ef: Add `ttl` config to `createEntityConfig` for setting a DynamoDB TTL on an entity (see `@monorise/base`/`@monorise/core` changes). Also, `monorise/sst`'s `SingleTable`/`MonoriseCore` now always use `expiresAt` as the DynamoDB TTL attribute and no longer accept `ttl`/`tableTtl` args — remove those from your sst config.

  Also fixes two related bugs: `Mutual#expiresAt` now returns epoch seconds instead of an ISO string (DynamoDB TTL requires epoch seconds), and `upsertEntity` no longer throws when called with an `entityId` that hasn't been created yet — it now falls back to creating the entity.

## 1.0.1

### Patch Changes

- 9e351bc: Loosen sst peer dependency from exact `4.7.3` to `^4.7.3` to allow newer minor/patch versions.

## 1.0.0

### Major Changes

- e6a935f: Upgrade to SST v4

  - Bumped `sst` peer dependency from `^3.16.3` to `4.7.3`
  - Fixed internal type leak in `QFunction` that referenced `.sst/platform` paths
  - Updated `examples/basic` to use SST v4 and the unified `monorise` package
  - Added migration guide at `docs/MIGRATE-SST-V4.md`

### Patch Changes

- 8e1333a: Fix MonoriseEntityConfig adjustmentConstraints minField/maxField defaulting to never when generic params are not specified

## 0.1.0

### Minor Changes

- b5a1fea: Add adjustEntity for atomic numeric updates on entity fields. Uses DynamoDB's native arithmetic expressions (SET field = field + delta) for race-condition-free concurrent writes. Useful for counters, accumulators, and real-time metrics.

## 0.0.5

### Patch Changes

- b59075f: Fix combined package DTS rewriting and CLI monorepo detection

  - build.js: Fix regex that missed rewriting some `@monorise/*` imports in `.d.ts` files (global regex `lastIndex` bug + missing double-quote patterns)
  - cli: Add `detectCombinedPackage()` that walks up directory tree for monorepo hoisting support, and generate correct module augmentation based on detection

## 0.0.4

### Patch Changes

- ca13559: Add limit param support to useEntities, with useState for stable tracking. Default params to { limit: 20 }. listMore respects the same limit. Add limit to CommonOptions for useMutuals and listMoreEntities.
- 9692fa3: Fix NaN limit in list-entities controller when limit query param is not provided

## 0.0.3

### Patch Changes

- eb14403: Add limit support to CommonOptions, listMoreEntities, and useEntities listMore for consistent pagination
- b59075f: Fix combined package DTS rewriting and CLI monorepo detection

  - build.js: Fix regex that missed rewriting some `@monorise/*` imports in `.d.ts` files (global regex `lastIndex` bug + missing double-quote patterns)
  - cli: Add `detectCombinedPackage()` that walks up directory tree for monorepo hoisting support, and generate correct module augmentation based on detection

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
