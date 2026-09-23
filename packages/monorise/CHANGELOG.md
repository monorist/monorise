# monorise

## 1.12.0

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

## 1.11.0

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

- f750b6d: Fix: `updateEntity` now validates its payload as a partial, so a partial update is no longer rejected for fields it isn't touching.

  Both update paths — `EntityService.updateEntity` (`PATCH /entity/:entityType/:entityId`, i.e. the client's `editEntity`/`updateEntity`) and `TransactionService`'s `updateEntity` operation (`POST /transaction`) — validated the submitted payload against the entity's full `mutualSchema`, and `EntityService.updateEntity` additionally validated it against the un-partialed `baseSchema`. A patch that changed a couple of ordinary fields came back `400 API_VALIDATION_ERROR` with a `Required` error for every mutual field the update never mentioned:

  ```
  POST /transaction
  {"operations":[
    {"operation":"updateEntity","entityType":"parent","entityId":"…",
     "payload":{"state":{…},"status":"IN_PROGRESS","tallyA":0,"tallyB":0}}]}

  400 {"code":"API_VALIDATION_ERROR","message":"Validation failed",
   "details":{"fieldErrors":{"ownerIds":["Required"],"regionIds":["Required"],
     "catalogIds":["Required"],"members":["Required"]}}}
  ```

  This contradicted the declared types on both paths (`payload: Partial<EntitySchemaMap[T]>`), and it contradicted the transaction path's own handling of `baseSchema`, which was already `.partial()`ed. The only way through was for the caller to re-read every existing relationship and re-send it on every unrelated edit.

  Both update paths now derive their schemas through a shared `toPartialUpdateSchema` helper (cached per source schema). The change is deliberately narrow:

  - **Shallow, not deep.** A field the caller _did_ send must still satisfy its full declared shape — a wrong type, a bad enum value, or a half-built nested object is still a 400. Only _absence_ is forgiven.
  - **Create paths are untouched.** `createEntity`, `collectCreateEvents`, `afterCreateEntityHook`, `finalSchema` and `UpsertEntityController`'s insert case keep parsing against the strict `createSchema` / `createMutualSchema` / `effectiveMutualSchema`. `createMutualSchema` keeps working exactly as before — it just no longer has to be paired with a hand-written `.partial()` on `mutualSchema` to avoid breaking updates.
  - **`upsertEntity` is untouched — but NOT because `PUT` is replace-semantics.** On the existing-entity branch it builds the same field-level `SET #data.#<key>` expression `updateEntity` uses, guarded by `attribute_exists(PK)`, so a `PUT` against an existing entity already merges; a key the caller omits is a key the write never mentions. The real blocker is that `UpsertEntityController`'s mutual loop has no `if (!mutualPayload) continue` guard (unlike the update path), so a partialed `mutualSchema` there would publish `ENTITY_MUTUAL_TO_UPDATE` with `mutualIds: undefined` for every relationship the caller never mentioned. Fixing that is larger than this change. **Known consequence:** until it is fixed, the same payload gets 200 on `PATCH` and `POST /transaction` but still 400 on `PUT` for an entity that already exists.
  - **`adjustEntity` is untouched.** It never ran a schema parse; it validates finite numbers only.

  Mostly permissive, but **not entirely** — two behaviour changes to check before upgrading. Both apply even to configs already authored `.partial()` (the previously documented convention), so "I followed the convention" is not on its own a reason to skip this section.

  - **A patch with no recognised base OR mutual field is now `400`, where it used to be a `200` no-op.** `{}` and `{ typoedFieldName: 1 }` previously reached the repository, wrote nothing to `data`, still bumped `updatedAt` and still published `entity-updated`. They are now rejected. This is deliberate — a mistyped field name silently reporting success is worse than an error — but it is a rejection of input that used to be accepted. If you rely on `PATCH {}` as a "touch" to bump `updatedAt`, that call now fails.
  - **A top-level `.default()` on `baseSchema` is no longer injected into an update payload.** An update can no longer silently reset a field the caller never mentioned back to its create-time default (e.g. an unrelated edit resetting a stored `COMPLETE` status back to `PENDING`).

  Everything else is purely permissive: payloads that were accepted before are still accepted, and the fix only stops rejecting patches for fields they never touched.

### Patch Changes

- 88f5730: Fix: validation errors now return `400` instead of `500` in a bundled deployment.

  Three controllers detected a `ZodError` with `(err as ZodError).constructor?.name === 'ZodError'` — `execute-transaction`, `create-entity` and `update-entity`. A bundler renames the class (observed as `_ZodError` in a deployed Lambda bundle), so the check never matched and every service-level validation error fell through to the generic `500` handler.

  This only reproduces in a bundled build. Unbundled source keeps the original class name, so local runs and unit tests pass either way — which is why it went unnoticed.

  Now checks `(err as ZodError)?.name === 'ZodError'`. zod sets `name` as an own instance property in its constructor, so it survives identifier renaming — under `--minify` the class becomes something like `r`, while `name` stays `'ZodError'`.

  The three sites that detect with `instanceof ZodError` (`upsert-entity`, `create-mutual`, `update-mutual`) are deliberately unchanged: the imported binding and the thrown class are renamed together, so identity still holds under bundling. Only `constructor.name` was broken.

## 1.10.0

### Minor Changes

- 312916e: Add an `executeTransaction` action to `@monorise/react` that auto-updates the local cache from `coreService.executeTransaction`'s result, matching the cache guarantees `createEntity`/`editEntity`/`adjustEntity`/`deleteEntity` already give a single-entity call.

  Previously, `coreService.transaction` (the atomic multi-entity write backed by `TransactionService.executeTransaction`) had no action-layer wrapper — a transactional write left the local store untouched, forcing callers to hand-roll cache patching or force a refetch. The new `executeTransaction` action folds each result entry back into the store: entity `dataMap`, mutual lists, and tag slices.

  Along the way:

  - Renames the client-side service method from `transaction` to `executeTransaction`, matching `TransactionService.executeTransaction`'s own name and this codebase's verb-first action convention (`createEntity`, `editEntity`, ...).
  - Fixes `core.service.ts`'s call using a hardcoded `requestKey: 'transaction'`, which let concurrent calls collide on one shared loading/error slot. Every transaction operation already carries a real, deterministic key via the same convention `createEntity`/`editEntity`/`adjustEntity`/`deleteEntity` use (`getEntityRequestKey(mode, entityType, entityId)`), so there's never a need to invent one — a new shared `getTransactionOperationRequestKey` helper (`helpers/transactional.ts`) derives it per operation, for both the underlying HTTP call's own key and each operation's individual loading/error signal (so a component checking a specific entity via `useLoadStore`/`getError` sees "mutating" during a transaction exactly as it would during a standalone call on that entity).
  - Extracts `createEntity`'s mutual-store population into a shared `populateMutualsForCreatedEntity` helper, so an entity created via `executeTransaction` also appears in already-loaded mutual lists — previously only the standalone `createEntity` action did this.
  - Extends `TransactionResultEntry` (`@monorise/core`) with optional `createdAt`/`updatedAt`, populated in `TransactionService`'s `processOperation`, so the client can build a proper `CreatedEntity`-shaped cache row for `createEntity` results and bump timestamps for `updateEntity`/`adjustEntity` results.

## 1.9.0

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

## 1.8.0

### Minor Changes

- 2966137: Add link prop to MonoriseCoreArgs to forward extra SST links to the app handler Lambda

## 1.7.0

### Minor Changes

- 837c455: Add opt-in Athena analytics with schema-generated entity and mutual datasets, durable history, daily current-state materialization, point-in-time backfill, named query API, deployment-managed views, and scheduled Iceberg models.

## 1.6.4

### Patch Changes

- eac60b7: fix: stop entity edits overwriting flipped mutual data, and propagate updates to chained mutual slices

## 1.6.3

### Patch Changes

- e58c9a8: Keep the React transactional builder browser-safe.

  - `@monorise/react` no longer re-exports `transactional` from `@monorise/core`,
    so browser bundles no longer pull in server-only Core code (AWS SDK, `fs`,
    `async_hooks`). React exposes its own builder with the same wire format.
  - The unified `monorise` root no longer exports `transactional` (the name is
    ambiguous between the Core and React copies). Use `monorise/core` on the
    server or `monorise/react` in the browser instead. All other root exports
    are unchanged.

## 1.6.2

### Patch Changes

- 90a45e2: Generate an application-owned `X_API_KEY` secret for backend proxies instead of embedding the selected Core API key in the Next.js environment.
- ee44ed4: Return 404 instead of 500 when a named function update condition targets a missing entity.

## 1.6.1

### Patch Changes

- 90e7486: Release CLI custom route generation fixes in the unified package.

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
