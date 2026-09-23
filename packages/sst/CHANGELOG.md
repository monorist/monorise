# @monorise/sst

## 4.5.0

### Minor Changes

- 2610ad5: Add an optional WebSocket layer for real-time entity and mutual updates, plus graph-aware entity feed subscriptions.

  Opt in with `webSocket: { enabled: true }` on `MonoriseCore`; projects that leave it off are unaffected. Mutations continue to go over HTTP, so authorization stays a per-write check and callers keep cache invalidation for free; the socket carries reads only.

  ### WebSocket layer

  - Lambda handlers for `$connect`, `$disconnect`, `$default` and broadcast
  - SST `MonoriseCore` gains a `webSocket` option that provisions an API Gateway WebSocket API
  - DynamoDB Streams drive broadcast of entity and mutual changes
  - CLI generates the WebSocket handler re-exports in `handle.ts`
  - React hooks `useEntitySocket`, `useMutualSocket` and `useEphemeralSocket`, with exponential-backoff reconnect and auto-refetch on reconnect so events missed while disconnected are not lost
  - Subscriptions are keyed by entity TYPE rather than entity id, which bounds connection-table growth

  ### Entity feed subscriptions

  `broadcastToFeedSubscribers()` resolves recipients by walking the changed entity's mutual relationships plus the entity itself, so a client subscribed to one subject also receives changes to entities connected to it without subscribing to each one. `useEntityFeed` routes those broadcasts into the stores, so components using the existing hooks update with no extra wiring.

  Two behaviours worth knowing when adopting this:

  - `feedTypes` are resolved transitively through the mutual config graph. Deriving them from the subject's own `mutualFields` alone misses any type whose edge is declared on the other side of the relationship, and the failure is silent: the socket connects and then delivers nothing.
  - A shared entity id does not imply feed reachability. Two entities sharing an id are still unrelated for fan-out; a mutual is required.

  Broadcast subscriber queries use `ConsistentRead`, since an eventually-consistent read here drops recipients, and `$disconnect` clears every subscription record for the connection via the R1 GSI.

  ### Ticket-based auth

  The browser WebSocket API cannot set headers, which usually leaves a token in the query string or an unauthenticated connect. Instead, `POST /ws/ticket/:entityType/:entityId` issues a short-lived (30 minute), one-time, DynamoDB-stored ticket. `$connect` accepts ticket auth alongside token auth and creates the feed subscription on connect. `@monorise/proxy` exports `generateWebSocketTicket()` so a server-side proxy can mint one for a client that must not hold a long-lived credential.

  ### Fixes

  - `baseSchema` is now always included in `FinalSchemaType`
  - The `sst` peer dependency is loosened from an exact `4.7.3` to `^4.7.3`

  ### No change to DynamoDB TTL

  Calling this out because an earlier revision of this branch did change it: `SingleTable` still hardcodes the TTL attribute as `expiresAt`, and neither it nor `MonoriseCore` accepts a `ttl`/`tableTtl` argument. That is unchanged behaviour, not a new constraint -- monorise's own internals (mutual and tag locks, entity-level TTL, analytics executions) all write that attribute name, so it cannot be configurable.

  ### Note on fan-out cost

  Fan-out is proportional to the changed entity's mutual degree, so an entity whose per-update payload grows with the number of related records produces frames that grow with it. The fix is schema-side: split frequently-updated fields onto their own entity so each update touches a small, flat record.

  ### Moved exports

  `WebSocketManager` and `OptimisticEngine` now live in `@monorise/react` rather than `@monorise/core`:

  ```typescript
  // Before
  import { WebSocketManager } from "@monorise/core";

  // After
  import { WebSocketManager } from "@monorise/react";
  ```

  This is a breaking move for anyone importing either symbol from `@monorise/core`. It is released as a minor deliberately: the WebSocket layer has no consumers on these exports yet, so spending a major on relocating them buys nothing.

## 4.4.0

### Minor Changes

- 2966137: Add link prop to MonoriseCoreArgs to forward extra SST links to the app handler Lambda

## 4.3.0

### Minor Changes

- 837c455: Add opt-in Athena analytics with schema-generated entity and mutual datasets, durable history, daily current-state materialization, point-in-time backfill, named query API, deployment-managed views, and scheduled Iceberg models.

## 4.2.0

### Minor Changes

- 2060848: Add a `cloudwatchLogRetention` option to configure log retention for Monorise core Lambda functions.
- 07842ff: Add a `cloudwatchDashboard` option to make the built-in CloudWatch dashboard toggleable. Set `cloudwatchDashboard: { enabled: false }` to skip creating the dashboard — useful for test and personal stages where the dashboard would only add cost. Defaults to enabled, so existing stages are unaffected. Note: disabling it on a stage where the dashboard already exists will destroy the dashboard on the next deploy.

## 4.1.0

### Minor Changes

- 9d175ef: `SingleTable`/`MonoriseCore` now always use `expiresAt` as the DynamoDB TTL attribute name and no longer accept `ttl`/`tableTtl` args. This was previously user-configurable, but the codebase already hardcodes `expiresAt` internally (mutual/tag locks, and now entity TTL), so a mismatched or unset value silently left TTL disabled.

  Remove `ttl`/`tableTtl` from your sst config — the table will always use `expiresAt`. If you're importing an existing table via `fromTableName`, make sure its TTL attribute is named `expiresAt`.

## 4.0.2

### Patch Changes

- 9569501: feat(sst): support reusing existing DynamoDB table in SingleTable

## 4.0.1

### Patch Changes

- 9e351bc: Loosen sst peer dependency from exact `4.7.3` to `^4.7.3` to allow newer minor/patch versions.

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
