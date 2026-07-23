# monorise

## 1.7.0

### Minor Changes

- Add opt-in Athena analytics with schema-generated entity and mutual datasets, durable history, daily current-state materialization, and point-in-time backfill.

## 1.6.0

### Minor Changes

- 7a95a4e: Add transactional writes for atomic multi-entity operations

  - `POST /core/transaction` endpoint for atomic multi-entity operations
  - Supports createEntity, updateEntity, adjustEntity, deleteEntity in single DynamoDB TransactWriteItems call
  - All-or-nothing: if any operation fails, entire transaction rolls back
  - Events (ENTITY_CREATED, ENTITY_UPDATED, ENTITY_DELETED) published only after commit succeeds
  - Condition support: adjustmentConditions and updateConditions work within transactions
  - React SDK: `transaction()` function for frontend usage
  - DynamoDB limit enforced: max 100 items per transaction

## 1.5.0

### Minor Changes

- 6488933: Add named conditions system for conditional entity writes

  - `adjustmentConditions`: server-defined preconditions for `adjustEntity`. `$condition` required when defined. Condition functions receive `(data, adjustments)`.
  - `updateConditions`: server-defined preconditions for `updateEntity`. `$condition` always optional. Condition functions receive `(data)`.
  - Clients send a condition name (`$condition: 'withdraw'`), server resolves to DynamoDB ConditionExpression. Raw operators never exposed to frontend.
  - Deprecates `adjustmentConstraints` (backward compatible — falls back automatically when no `adjustmentConditions` is defined).
  - **Breaking (security):** raw `$where` on `updateEntity` is now rejected by default (`INVALID_CONDITION`, 400) instead of silently accepted with a warning. Opt in per entity with `allowLegacyWhere: true` (not recommended) or migrate to named `updateConditions`.

## 1.4.0

### Minor Changes

- 78c369d: Enhanced CLI init command with full project scaffolding and example page

  The `npx monorise init` command now creates a complete monorepo setup:

  - Creates apps/ and services/ directory structure
  - Scaffolds Next.js app in apps/web/
  - Installs SST v4, monorise, hono, and zod
  - Creates services/core/routes.ts with Hono app template
  - Generates sst.config.ts with monorise module
  - Configures monorise.config.ts with customRoutes
  - Sets up tsconfig path aliases
  - Creates example page.tsx demonstrating useEntities and createEntity
  - Generates a starter Team entity and a shared createMutualConfig
    (monorise/mutuals/team-membership.ts), demonstrating a User <-> Team mutual
    relationship
  - Runs initial monorise build

  Simplified imports:

  - `monorise dev`/`monorise build` now also generate `.monorise/index.ts`
    (re-exporting `.monorise/config.ts`), so generated types can be imported via
    `#/monorise` instead of `#/monorise/config`. The longer path keeps working
    for backward compatibility.

  Documentation updates:

  - Updated messaging to emphasize time-to-production
  - Added "Ship in Hours" benefit
  - Simplified getting started guide

  Bug fix:

  - Fixed www/package.json version field

## 1.3.0

### Minor Changes

- 2060848: Add a `cloudwatchLogRetention` option to configure log retention for Monorise core Lambda functions.
- 07842ff: Add a `cloudwatchDashboard` option to make the built-in CloudWatch dashboard toggleable. Set `cloudwatchDashboard: { enabled: false }` to skip creating the dashboard — useful for test and personal stages where the dashboard would only add cost. Defaults to enabled, so existing stages are unaffected. Note: disabling it on a stage where the dashboard already exists will destroy the dashboard on the next deploy.

## 1.2.1

### Patch Changes

- a1b26e2: Fix `flipMutual` so the flipped-side mutual cache entry's `data` describes the correct entity. Previously the flipped record reused the original side's `data`, which made `useMutuals` on the opposite view briefly render the wrong entity's fields after `createMutual`/`editMutual`/`upsertLocalMutual`/`createLocalMutual` — until a refresh refetched that side from the server.
- 6f690cc: Fix `useEntities` so that content-only edits propagate to the local `entities` snapshot. Previously the effect only called `setEntities` when `dataMap.size !== entities?.length`, so an edit that mutated an entity in place (same id, new field values) was silently ignored and the consumer kept rendering stale data until a full reload. The comparison now also walks `dataMap` and falls back to a JSON content compare, matching the existing behavior of `useMutuals`.

## 1.2.0

### Minor Changes

- 04f6713: Add `createMutualConfig` for centralized mutualData schema validation. Define a Zod schema once for mutual relationships and reference it from both entity configs. Validates mutualData on create, update, and processor output.

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
