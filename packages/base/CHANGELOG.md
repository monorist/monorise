# @monorise/base

## 4.1.0-dev.2

### Minor Changes

- 8c1c228: Add `createMutualConfig` for centralized mutualData schema validation. Codegen `MutualDataMapping` for frontend type narrowing. Build-time duplicate detection for conflicting mutual configs.

## 4.1.0-dev.1

### Minor Changes

- afbd0e9: Add `createMutualConfig` for centralized mutualData schema validation. Define a Zod schema once for mutual relationships and reference it from both entity configs. Validates mutualData on create, update, and processor output.

## 4.1.0-dev.0

### Minor Changes

- d8220f9: Add named conditions system for conditional entity writes

  - `adjustmentConditions`: server-defined preconditions for `adjustEntity`. `$condition` required when defined. Condition functions receive `(data, adjustments)`.
  - `updateConditions`: server-defined preconditions for `updateEntity`. `$condition` always optional. Condition functions receive `(data)`.
  - Clients send a condition name (`$condition: 'withdraw'`), server resolves to DynamoDB ConditionExpression. Raw operators never exposed to frontend.
  - Deprecates `adjustmentConstraints` (backward compatible) and raw `$where` on updateEntity (backward compatible with warning).

### Patch Changes

- 7b9cd73: Add ticket-based auth for WebSocket entity feed subscriptions.

  - `POST /ws/ticket/:entityType/:entityId` endpoint for ticket generation
  - Tickets are short-lived (30min TTL), one-time use, stored in DynamoDB
  - `$connect` handler supports ticket auth alongside token auth
  - Feed subscriptions auto-created on ticket-based connections
  - `monorise/proxy` package with `generateWebSocketTicket()` helper
  - feedTypes resolved transitively through mutual config graph
  - Fix: baseSchema now always included in FinalSchemaType

## 4.0.0

### Major Changes

- e6a935f: Upgrade to SST v4

  - Bumped `sst` peer dependency from `^3.16.3` to `4.7.3`
  - Fixed internal type leak in `QFunction` that referenced `.sst/platform` paths
  - Updated `examples/basic` to use SST v4 and the unified `monorise` package
  - Added migration guide at `docs/MIGRATE-SST-V4.md`

### Patch Changes

- 8e1333a: Fix MonoriseEntityConfig adjustmentConstraints minField/maxField defaulting to never when generic params are not specified

## 3.1.0

### Minor Changes

- b5a1fea: Add adjustEntity for atomic numeric updates on entity fields. Uses DynamoDB's native arithmetic expressions (SET field = field + delta) for race-condition-free concurrent writes. Useful for counters, accumulators, and real-time metrics.

## 3.0.2

### Patch Changes

- 7a29b6a: Fix tag processor type inference to use baseSchema shape instead of CreatedEntity<T>

## 3.0.2-dev.0

### Patch Changes

- 5d4b618: Fix tag processor type inference to use baseSchema shape instead of CreatedEntity<T>

## 3.0.1

### Patch Changes

- 5e8d320: Unified monorise package

## 3.0.0

### Major Changes

- 70c31c7: Bump to v3

## 2.0.0

### Major Changes

- Bump version

## 1.0.0

### Major Changes

- Release v3.0.0 - Major stable release
- 54beb03: monorise to support sst v3

## 1.0.0-dev.0

### Major Changes

- 54beb03: monorise to support sst v3

## 0.0.5

### Patch Changes

- 1fd91c6: Fix @monorise/base import relatively instead of recursively

## 0.0.4

### Patch Changes

- 47957b2: Introduce unique fields

## 0.0.3

### Patch Changes

- 06e2048: add unique fields to createEntityConfig

## 0.0.2

### Patch Changes

- 83579b5: FinalSchema with effect should resolve typing correctly
- 83579b5: Zod as peer dependency
- 83579b5: export createEntityConfig from base package
- 83579b5: simplify effect typing

## 0.0.2-dev.3

### Patch Changes

- bfc0a44: FinalSchema with effect should resolve typing correctly

## 0.0.2-dev.2

### Patch Changes

- b222348: simplify effect typing

## 0.0.2-dev.1

### Patch Changes

- 5ec72a5: Zod as peer dependency

## 0.0.2-dev.0

### Patch Changes

- 9b6090c: export createEntityConfig from base package

## 0.0.1

### Patch Changes

- d228c47: setup changesets

## 0.0.1-dev.0

### Patch Changes

- d228c47: setup changesets
