# @monorise/sst

## 4.1.0-dev.0

### Minor Changes

- 7b9cd73: Add ticket-based auth for WebSocket entity feed subscriptions.

  - `POST /ws/ticket/:entityType/:entityId` endpoint for ticket generation
  - Tickets are short-lived (30min TTL), one-time use, stored in DynamoDB
  - `$connect` handler supports ticket auth alongside token auth
  - Feed subscriptions auto-created on ticket-based connections
  - `monorise/proxy` package with `generateWebSocketTicket()` helper
  - feedTypes resolved transitively through mutual config graph
  - Fix: baseSchema now always included in FinalSchemaType

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

## 4.0.0

### Major Changes

- e6a935f: Upgrade to SST v4

  - Bumped `sst` peer dependency from `^3.16.3` to `4.7.3`
  - Fixed internal type leak in `QFunction` that referenced `.sst/platform` paths
  - Updated `examples/basic` to use SST v4 and the unified `monorise` package
  - Added migration guide at `docs/MIGRATE-SST-V4.md`

## 3.1.0

### Minor Changes

- e7ca0ff: Add built-in CloudWatch dashboard to MonoriseCore with per-function metrics and DLQ monitoring

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

### Patch Changes

- 851de3f: adding missing permission for mutual processor
- a83462f: update:

  - sst: support `configRoot`
  - sst: piggyback fix tsconfig.json indefinite loop when build
  - sst: comment out unused send alarm handler
  - cli: support `--config-root`
  - cli: piggyback fix tsconfig.json indefinite loop when build

## 1.0.0-dev.2

### Patch Changes

- a83462f: update:

  - sst: support `configRoot`
  - sst: piggyback fix tsconfig.json indefinite loop when build
  - sst: comment out unused send alarm handler
  - cli: support `--config-root`
  - cli: piggyback fix tsconfig.json indefinite loop when build

## 1.0.0-dev.1

### Patch Changes

- 851de3f: adding missing permission for mutual processor

## 1.0.0-dev.0

### Major Changes

- 54beb03: monorise to support sst v3
