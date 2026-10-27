# @monorise/proxy

## 3.1.0

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
