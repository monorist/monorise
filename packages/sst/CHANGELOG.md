# @monorise/sst

## 4.7.0-dev.2

### Minor Changes

- d89c699: Add `monorise devtool`, a local entity dashboard that discovers project entity
  configs and supports listing, pagination, configured search, create, update,
  and delete operations. Browse configured tag indexes with group, prefix, and
  range filters, and inspect an entity's mutual relationships in either direction.
  Mutual relationships can be created, updated, and deleted with schema-aware
  mutual data templates. Entity schema references identify unique fields and
  scroll independently from the JSON editor. API requests pass through a
  restricted local proxy so configured API keys remain in the Node process
  instead of the browser. Discover deployed SST stages and their Monorise API
  Gateway URLs, and switch between each stage's scoped API keys by policy and
  fingerprint. The devtool defaults to the browser-safe port `6767`.

## 4.7.0-dev.1

### Minor Changes

- cc0e9d8: Core's resources share one prefix, `<app>-<stage>-<id>`, app first as in SST's generated names, so a stage's resources sort together: `shop-prod-core-table`, `shop-prod-core-mutual-queue`, `shop-prod-core-mutual-dlq`, `shop-prod-core-replicator-dlq`, `shop-prod-core-app-handler`. Before, the table and queues had generated names such as `shop-prod-corecoretableTable-abcdefgh`, and the functions were named `prod-shop-core-…`.

  - **New stages** get the new names.
  - **Existing stages keep their table.** AWS can't rename a table, and a new name would replace it with an empty one.
  - **Existing stages' queues are replaced** with new ones under the new names on the next deploy. Messages still in the old queues are deleted with them: redrive or clear the dead-letter queues first, and deploy while the app is quiet.
  - **Existing stages' functions are replaced** under the new names, and keep logging to their existing log groups. If an entity uses `search`, the search index is rebuilt once. Core's dashboard and `QFunction`'s DLQ alarm are renamed the same way.

  `QFunction` accepts `queueName` and `dlqName`. Without them, its queues keep SST's generated names.

## 4.7.0-dev.0

### Minor Changes

- The dev pre-releases now include everything released from main up to base 4.8.0 and core 4.11.0: indexed search, warnings instead of failures for removed analytics fields, mutual traces behind `MONORISE_DEBUG`, and the CloudWatch dashboard off by default. API key search checks now cover an entity's indexed `search` fields, not only `searchableFields`. Base, cli and sst stay a minor above main's releases, since dev adds API key policies, the proxy template and the `default` policy placeholder on top of them.

## 4.6.0-dev.0

### Minor Changes

- 2b0c3aa: Add the built-in `default` API key policy: keys you can narrow later without changing them. Keys under `default` in `API_KEYS` can do everything `full` can until the project defines a policy named `default`; from then on they get exactly what it grants. The SST placeholder for `API_KEYS` is now `{"default": ["secret1", "secret2"]}`, and `monorise init` scaffolds `monorise/api-keys.ts` and points `apiKeys` at it. The array form still gives every key `full`, unchanged.

## 4.6.0

### Minor Changes

- 2d36c4b: Indexed search: entities can now be searched by word without reading every entity of the type. Set `search` on an entity config instead of `searchableFields`:

  ```ts
  search: {
    fields: [{ field: 'name' }, { field: 'email' }],
  },
  ```

  Each field is split into words on spaces and symbols, and each word is stored as a copy of the entity. `?query=john doe` then reads only the copies under its longest word, instead of every entity.

  - **Matching.** Plain words match from the start of a word, in any order (`jo do` finds "John Doe"). Quoted text (`"john doe"`) and text joined by symbols (`jane@mail.com`) must also appear exactly. Matching mid-word ("lumbing" in "plumbing") isn't supported.
  - **Settings.** `maxWords` (default 8) caps the words indexed per entity, and `ignoreWords` (default `DEFAULT_IGNORE_WORDS`, also known as stop words) lists words that are never indexed. Both can also be set for every entity under `search` in `monorise.config.ts`; an entity's own setting replaces the global one.
  - **Cost.** Every update of an entity writes up to `maxWords` extra items, whichever field changed, because the replication processor keeps each copy current.
  - **Rollout.** On deploy, a new reindex function builds the index for existing entities whenever an entity's search config changes. Until it finishes, queries on that type scan every entity, with the same results. A part that fails is retried twice; after that the build stops and a CloudWatch alarm notifies the Monorise alarm topic.
  - **Response.** For `search` types, `filteredCount` is the number of matches and there's no `totalCount`: counting every entity would take the scan the index avoids.

  **Nothing changes for existing projects.** `searchableFields` keeps scanning every entity as before. It now also handles array and number fields, which used to make every search on the type fail.

  **React.** `useEntities` search results now follow the latest query only, even when an earlier search answers last; before, a search sent while another was in flight was handed the earlier query's results. A failed search no longer blocks later ones. For entities that use `search`, a query without a word of two or more letters shows the list without a request. A search result older than the client's copy of an entity no longer overwrites it, and results show edits to entities in them and drop deleted ones.

  `@monorise/core` now uses search helpers from `@monorise/base` at runtime, so upgrade the two together.

### Patch Changes

- 33fb123: The built-in CloudWatch dashboard is now disabled by default, because each dashboard adds cost. Set `cloudwatchDashboard: { enabled: true }` to keep it, for example `cloudwatchDashboard: { enabled: $app.stage === 'production' }`. **Breaking:** stages that relied on the old default will have their dashboard destroyed on the next deploy unless they opt in.

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
