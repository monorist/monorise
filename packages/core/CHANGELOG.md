# @monorise/core

## 5.0.0-dev.0

### Major Changes

- 7b9cd73: Add WebSocket layer for real-time entity updates

  ### Features

  - Optional WebSocket support in MonoriseCore with `webSocket: { enabled: true }` config
  - HTTP for mutations (reliable) + WebSocket for real-time updates (scalable)
  - Entity-type subscriptions for scalability (not entity-id)
  - Auto-refetch on reconnect to catch missed events during disconnect
  - Lambda handlers: $connect, $disconnect, $default, broadcast
  - DynamoDB Streams integration for change broadcasting

  ### Breaking Changes

  - **@monorise/core**: Removed WebSocketManager and OptimisticEngine exports (moved to @monorise/react)
  - Import WebSocketManager from `@monorise/react` instead of `@monorise/core`

  ### Migration

  ```typescript
  // Before
  import { WebSocketManager } from "@monorise/core";

  // After
  import { WebSocketManager } from "@monorise/react";
  ```

  ### New React Hooks

  - `useWebSocketConnection()`: Monitor connection state
  - `useEntitySocket(entityType)`: Subscribe to entity type changes
  - `useMutualSocket(byEntityType, byEntityId, mutualEntityType)`: Subscribe to mutual relationship changes
  - `useEphemeralSocket(channel)`: Ephemeral messaging for typing indicators, live cursors, presence

### Minor Changes

- 7b9cd73: Add feed subscription broadcast resolution via mutual graph traversal.

  - `broadcastToFeedSubscribers()` resolves affected feed subscribers when changes occur
  - Traverses mutual relationships to find connected entities with feed subscriptions
  - Filters by feedTypes whitelist, deduplicates per-connection
  - ConsistentRead on all broadcast subscriber queries
  - Broadcast always runs feed resolution (not skipped when no direct subscribers)
  - $disconnect cleans up all subscription records via R1 GSI

- 7b9cd73: Add ticket-based auth for WebSocket entity feed subscriptions.

  - `POST /ws/ticket/:entityType/:entityId` endpoint for ticket generation
  - Tickets are short-lived (30min TTL), one-time use, stored in DynamoDB
  - `$connect` handler supports ticket auth alongside token auth
  - Feed subscriptions auto-created on ticket-based connections
  - `monorise/proxy` package with `generateWebSocketTicket()` helper
  - feedTypes resolved transitively through mutual config graph
  - Fix: baseSchema now always included in FinalSchemaType

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

## 4.0.0

### Major Changes

- e6a935f: Upgrade to SST v4

  - Bumped `sst` peer dependency from `^3.16.3` to `4.7.3`
  - Fixed internal type leak in `QFunction` that referenced `.sst/platform` paths
  - Updated `examples/basic` to use SST v4 and the unified `monorise` package
  - Added migration guide at `docs/MIGRATE-SST-V4.md`

## 3.2.0

### Minor Changes

- a76b169: Add conditional `$where` support to core entity PATCH updates so callers can apply atomic compare-and-set style updates with DynamoDB condition expressions.

  Map failed conditional checks to `CONDITIONAL_CHECK_FAILED` and return HTTP 409 from the update entity controller.

## 3.1.0

### Minor Changes

- b5a1fea: Add adjustEntity for atomic numeric updates on entity fields. Uses DynamoDB's native arithmetic expressions (SET field = field + delta) for race-condition-free concurrent writes. Useful for counters, accumulators, and real-time metrics.

## 3.0.4

### Patch Changes

- 9692fa3: Fix NaN limit in list-entities controller when limit query param is not provided

## 3.0.3

## 3.0.3

### Patch Changes

- da448be: Fix tag list endpoint crashing when limit query parameter is not provided. `Number(undefined)` produced `NaN` which caused a DynamoDB SerializationException.

## 3.0.2

### Patch Changes

- 5e8d320: Unified monorise package

## 3.0.1

### Patch Changes

- ddbee02: Add ScanIndexForward option to listEntitiesByEntity method for descending order

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

### Patch Changes

- e14f480: sync main branch fixes
  - #120
  - #121
  - #127
  - #138
  - #144
  - #148
- c3609ab: feat: dependency container access from custom route

## 1.0.0-dev.2

### Patch Changes

- e14f480: sync main branch fixes
  - #120
  - #121
  - #127
  - #138
  - #144
  - #148

## 1.0.0-dev.1

### Patch Changes

- c3609ab: feat: dependency container access from custom route

## 1.0.0-dev.0

### Major Changes

- 54beb03: monorise to support sst v3

## 0.1.13

### Patch Changes

- 2181e0a: fix unique field missing updatedAt timestamp

## 0.1.12

### Patch Changes

- dfdf262: fix tag processor race condition

## 0.1.11

### Patch Changes

- a6ce58a: unique field validation bug fix

## 0.1.10

### Patch Changes

- 5eafbba: feat: support limit mutuals returned

## 0.1.9

### Patch Changes

- 9ceb344: list mutuals and entities projection expression accepts any string.

## 0.1.8

### Patch Changes

- c134108: chore: expose MutualService class

## 0.1.7

### Patch Changes

- 087ae9d: code refactor:

  - refactor lastKey in core/data to receive and return as string, so users no need to wrap fromLastKeyQuery or toLastKeyResponse again
  - delete local mutual entities in deleteEntity function
  - add & expose helper function of getting requestKey, so users no need check back source code for create/edit/delete entity/mutual functions
  - added StandardErrorCode enum to organize all StandardError.code in framework

## 0.1.6

### Patch Changes

- 7fc2cf9: Update

  - chore: add `npm run dev` to ease development locally
  - feat: support more list tag query params
  - fix: potential undefined state
  - fix: unhandled message in processor/create-entity

## 0.1.5

### Patch Changes

- 84679d3: handle unique field transaction error

## 0.1.4

### Patch Changes

- edcc3e9: fix tsconfig exclude path to relative

## 0.1.3

### Patch Changes

- f23b09e: Change core package transpile target

## 0.1.2

### Patch Changes

- 992399f: fix @monorise/core export issue

## 0.1.1

### Patch Changes

- 68eac73: fix: @monorise/core export issue

## 0.1.0

### Minor Changes

- 47957b2: Introduce unique fields

### Patch Changes

- eccbfbd: - test cases for Mutual and Mutual Repository
  - fix get deleted Mutual still exists
  - refactored test helpers

## 0.0.4

### Patch Changes

- Updated dependencies [06e2048]
  - @monorise/base@0.0.3

## 0.0.3

### Patch Changes

- f95a5ed: \* chore(core): add tests for Entity and EntityRepository
  - fix(core): upsertEntity `updatedAt` not updated to latest time

## 0.0.2

### Patch Changes

- 6f5ce33: - expose `TagRepository` type
  - `listEntitiesByEntity`: added `'#'` at the end of `SK` value to prevent accidentally got unwanted entity (eg.: desire to get `company` entity but returned both `company` & `company-staff` entities)
  - `editEntity`: update local mutual state to latest entity data
  - `useEntities`: expose `lastKey` & `isFirstFetched` attribute
  - `useMutuals`: expose `lastKey` attribute and added `listMore` function

## 0.0.1

### Patch Changes

- 83579b5: update monorise/base as peer dependency
- 83579b5: Introduce core package
- 83579b5: update mock import
- 83579b5: Amend editMutual method to use PATCH method
- 83579b5: export data repository and service
- Updated dependencies [83579b5]
- Updated dependencies [83579b5]
- Updated dependencies [83579b5]
- Updated dependencies [83579b5]
  - @monorise/base@0.0.2

## 0.0.1-dev.4

### Patch Changes

- e48ed2e: Amend editMutual method to use PATCH method

## 0.0.1-dev.3

### Patch Changes

- b222348: export data repository and service
- Updated dependencies [b222348]
  - @monorise/base@0.0.2-dev.2

## 0.0.1-dev.2

### Patch Changes

- a2d3dab: update monorise/base as peer dependency

## 0.0.1-dev.1

### Patch Changes

- 9200378: update mock import

## 0.0.1-dev.0

### Patch Changes

- 4de00a9: Introduce core package
