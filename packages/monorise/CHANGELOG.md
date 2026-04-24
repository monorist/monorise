# monorise

## 1.1.0-dev.1

### Minor Changes

- afbd0e9: Add `createMutualConfig` for centralized mutualData schema validation. Define a Zod schema once for mutual relationships and reference it from both entity configs. Validates mutualData on create, update, and processor output.

## 1.1.0-dev.0

### Minor Changes

- d8220f9: Add transactional writes for atomic multi-entity operations

  - `POST /core/transaction` endpoint for atomic multi-entity operations
  - Supports createEntity, updateEntity, adjustEntity, deleteEntity in single DynamoDB TransactWriteItems call
  - All-or-nothing: if any operation fails, entire transaction rolls back
  - Events (ENTITY_CREATED, ENTITY_UPDATED, ENTITY_DELETED) published only after commit succeeds
  - Condition support: adjustmentConditions and updateConditions work within transactions
  - React SDK: `transaction()` function for frontend usage
  - DynamoDB limit enforced: max 100 items per transaction

- d8220f9: Add named conditions system for conditional entity writes

  - `adjustmentConditions`: server-defined preconditions for `adjustEntity`. `$condition` required when defined. Condition functions receive `(data, adjustments)`.
  - `updateConditions`: server-defined preconditions for `updateEntity`. `$condition` always optional. Condition functions receive `(data)`.
  - Clients send a condition name (`$condition: 'withdraw'`), server resolves to DynamoDB ConditionExpression. Raw operators never exposed to frontend.
  - Deprecates `adjustmentConstraints` (backward compatible) and raw `$where` on updateEntity (backward compatible with warning).

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
