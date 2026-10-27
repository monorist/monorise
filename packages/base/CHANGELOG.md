# @monorise/base

## 4.7.0

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

## 4.6.0

### Minor Changes

- 2fcf320: Add optional `asEntity` to `createMutualConfig`, letting a mutual relationship declare — once, on the config itself — that it should also be materialized as a first-class `Entity`. Materialization is now always synchronous and strongly consistent, and `MutualService.createMutual`'s `options.ensureEntityStrongConsistentWrite` is **removed**.

  Previously, `asEntity` was only available as an ad-hoc option passed at each imperative `MutualService.createMutual(...)` call site. Most real usage doesn't call `createMutual` imperatively at all: entity configs wire relationships declaratively via `mutualFields`, and monorise's own lifecycle hooks call `createMutual` on the engineer's behalf under the hood — with no way to opt a declaratively-wired mutual into `asEntity` behavior short of hand-rolling an imperative call and losing the `mutualFields` DX.

  `createMutualConfig` now accepts an `asEntity` option — the `createEntityConfig(...)` result for the entity type this mutual should materialize as, not just an `Entity` enum value:

  ```ts
  const enrollmentEntityConfig = createEntityConfig({
    name: Entity.ENROLLMENT,
    displayName: "Enrollment",
    baseSchema: z.object({ role: z.enum(["student", "auditor"]) }).partial(),
    createSchema: z.object({ role: z.enum(["student", "auditor"]) }),
  });

  const enrollmentMutual = createMutualConfig({
    entities: [Entity.STUDENT, Entity.COURSE],
    asEntity: enrollmentEntityConfig,
  });
  ```

  When `asEntity` is set, `mutualDataSchema` must be **omitted** — it's derived automatically from `asEntity.finalSchema` (that entity's own `baseSchema` + `createSchema` + `effectiveMutualSchema`, merged — the same schema this codebase already validates every normal `createEntity` payload against), so the mutual's data shape can never drift from the materialized entity's own shape. `finalSchema` (rather than a narrower `baseSchema`/`createSchema`-only derivation) is used deliberately: the `asEntity` path fires `afterCreateEntityHook` on the synthetic entity — the same hook that wires up an entity's own further `mutualFields` — so anything narrower would silently break that wiring for any `asEntity`-targeted entity that itself declares further relationships. Providing both `asEntity` and `mutualDataSchema` on the same config is a hard error, enforced both when `createMutualConfig` is called (fails fast at config-definition time) and at `monorise build`/`generate` time (catches a hand-rolled `MutualConfig` object that bypasses the factory).

  Every place monorise resolves this mutual config into a `createMutual` call — the imperative `MutualService.createMutual`, and the async processor that fires for declarative `mutualFields` entries — now also creates a real `Entity` (`entityType: asEntity.name`, `entityId: <the mutual's own ulid>`, `data: <the mutual's own parsed mutualData>`), so the relationship can be looked up via monorise's indexed `tags` mechanism instead of scanning and filtering every edge in application code.

  An explicit `options.asEntity` passed directly at an imperative `createMutual(...)` call site still takes precedence over the config-level value. A mutual config that doesn't set `asEntity` behaves exactly as before.

  ### Removed: `ensureEntityStrongConsistentWrite`

  `MutualService.createMutual`'s `options.ensureEntityStrongConsistentWrite` is gone, and `createMutualConfig` never gained an equivalent. **Materializing the entity is now always synchronous**: it is written in the same DynamoDB transaction as the mutual, and `afterCreateEntityHook` fires immediately after the commit.

  If you pass `ensureEntityStrongConsistentWrite` at a `createMutual` call site, delete the line — `true` was already the behavior you now get unconditionally, and `false`/omitted is exactly the path being removed.

  What the old `false` default did instead was publish an async `CREATE_ENTITY` event, leaving a window in which the mutual existed and its projection did not. That window was the source of every serious problem in this feature: the async branch published a storage-narrowed payload where the synchronous branch passed the full one, so the synthetic entity's own `mutualFields` never wired on the async path, and a required `createMutualSchema` field made the consumer's `finalSchema.parse` throw and DLQ the record. It also needed a post-commit retry-gap fix and a self-healing existence probe on every update — machinery that only existed because there were two paths. All of that is deleted along with the branch.

  The honest tradeoff, stated rather than omitted: `TransactWriteItems` consumes **2x the write capacity** of a plain write and adds some latency. It does not, however, "widen the mutual write into a big transaction" — the declarative processor issues one transaction per mutual, so this is roughly 5 items against a 100-item limit. The stricter failure semantics are deliberate: if the entity write fails, the mutual write rolls back with it rather than leaving an orphaned edge.

  ### Two behaviours worth knowing before you adopt this

  **What gets stored is narrower than what gets validated.** Because `mutualDataSchema` is derived from `asEntity.finalSchema`, it includes the target entity's own mutual-field keys (e.g. an `ENROLLMENT` that itself declares `badgeIds`). Those keys are validated and forwarded to `afterCreateEntityHook` — that's what makes the synthetic entity's own `mutualFields` wiring work — but they are deliberately **not** persisted: `mutual.mutualData` and the synthetic entity's `data` are written through the narrower `asEntity.createSchema ?? asEntity.baseSchema`. Storing them would both break the "mutual fields are never stored" invariant that applies to every other entity in this codebase, and bake in ids that go stale the moment those relationships change. This narrowing applies only to configs that set `asEntity`; nothing about existing mutuals changes.

  **Deleting the mutual does not promptly remove the synthetic entity.** `deleteMutual` is a soft delete — it sets `expiresAt`, which replication treats as an update, not a removal. The synthetic entity is removed only once DynamoDB's TTL sweep physically deletes the mutual item, which AWS does not guarantee to be prompt (typically within 48 hours). Until then the entity stays fully readable, `tags` lookups included. This is the same characteristic the existing entity-level `ttl` feature has — no entity read path filters on `expiresAt` — but it matters more here, since indexed `tags` lookups are the main reason to reach for `asEntity`. If your reads must not see deleted relationships, filter against the mutual side (which _does_ gate on `expiresAt` and so reads as gone immediately) or carry an explicit status field on the entity. Documented in `www/docs/concepts/mutuals.md`.

## 4.5.0

### Minor Changes

- 74c8e35: Add optional `createMutualSchema` to an entity's `mutual` config, letting a mutual field be required only at creation time while `mutualSchema` itself stays `.partial()` for updates.

  Previously, `mutualSchema` was the single schema validated on both create and update. Making it non-partial to enforce a required mutual field at creation would also force every future _update_ to resend that same field, even for edits unrelated to the relationship. Keeping it partial to avoid that meant a create could silently omit a required mutual link — the entity would be created, but never wired to the relationship, with no error anywhere.

  `createMutualSchema` closes that gap: when defined, its shape is merged into `mutualSchema` on the create path only (`EntityService.createEntity` → `EntityServiceLifeCycle.afterCreateEntityHook`, `TransactionService.collectCreateEvents`, `UpsertEntityController`'s insert case, and `finalSchema`'s construction) — so `createMutualSchema` only needs to declare the field(s) it's tightening, and any other mutual field `mutualSchema` declares is still validated and wired on create. The update path (`EntityService.updateEntity`, `TransactionService.collectUpdateEvents`) is untouched and always uses the ordinary `mutualSchema`. Fully backward compatible — entities with no `createMutualSchema` behave exactly as before.

  ```ts
  const mutualSchema = z
    .object({ organisationIds: z.string().array() })
    .partial();
  const createMutualSchema = z.object({ organisationIds: z.string().array() }); // required on create only

  const config = createEntityConfig({
    name: "competition",
    displayName: "Competition",
    baseSchema,
    createSchema,
    mutual: {
      mutualSchema,
      createMutualSchema,
      mutualFields: {
        organisationIds: { entityType: Entity.ORGANISATION },
      },
    },
  });
  ```

## 4.4.0

### Minor Changes

- 837c455: Add opt-in Athena analytics with schema-generated entity and mutual datasets, durable history, daily current-state materialization, point-in-time backfill, named query API, deployment-managed views, and scheduled Iceberg models.

## 4.3.0

### Minor Changes

- 6488933: Add named conditions system for conditional entity writes

  - `adjustmentConditions`: server-defined preconditions for `adjustEntity`. `$condition` required when defined. Condition functions receive `(data, adjustments)`.
  - `updateConditions`: server-defined preconditions for `updateEntity`. `$condition` always optional. Condition functions receive `(data)`.
  - Clients send a condition name (`$condition: 'withdraw'`), server resolves to DynamoDB ConditionExpression. Raw operators never exposed to frontend.
  - Deprecates `adjustmentConstraints` (backward compatible — falls back automatically when no `adjustmentConditions` is defined).
  - **Breaking (security):** raw `$where` on `updateEntity` is now rejected by default (`INVALID_CONDITION`, 400) instead of silently accepted with a warning. Opt in per entity with `allowLegacyWhere: true` (not recommended) or migrate to named `updateConditions`.

## 4.2.0

### Minor Changes

- 04f6713: Add `createMutualConfig` for centralized mutualData schema validation. Define a Zod schema once for mutual relationships and reference it from both entity configs. Validates mutualData on create, update, and processor output.

## 4.1.0

### Minor Changes

- 9d175ef: Add `ttl` config to `createEntityConfig` for setting a DynamoDB TTL on an entity. Define `ttl.processor` to compute `expiresAt` (epoch seconds or a `Date`) from the entity's data; it's recomputed on every create/update/upsert. Returning `undefined` means no expiry for that record.

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
