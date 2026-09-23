# @monorise/core

## 4.9.0

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

## 4.8.0

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

## 4.7.0

### Minor Changes

- 312916e: Add an `executeTransaction` action to `@monorise/react` that auto-updates the local cache from `coreService.executeTransaction`'s result, matching the cache guarantees `createEntity`/`editEntity`/`adjustEntity`/`deleteEntity` already give a single-entity call.

  Previously, `coreService.transaction` (the atomic multi-entity write backed by `TransactionService.executeTransaction`) had no action-layer wrapper — a transactional write left the local store untouched, forcing callers to hand-roll cache patching or force a refetch. The new `executeTransaction` action folds each result entry back into the store: entity `dataMap`, mutual lists, and tag slices.

  Along the way:

  - Renames the client-side service method from `transaction` to `executeTransaction`, matching `TransactionService.executeTransaction`'s own name and this codebase's verb-first action convention (`createEntity`, `editEntity`, ...).
  - Fixes `core.service.ts`'s call using a hardcoded `requestKey: 'transaction'`, which let concurrent calls collide on one shared loading/error slot. Every transaction operation already carries a real, deterministic key via the same convention `createEntity`/`editEntity`/`adjustEntity`/`deleteEntity` use (`getEntityRequestKey(mode, entityType, entityId)`), so there's never a need to invent one — a new shared `getTransactionOperationRequestKey` helper (`helpers/transactional.ts`) derives it per operation, for both the underlying HTTP call's own key and each operation's individual loading/error signal (so a component checking a specific entity via `useLoadStore`/`getError` sees "mutating" during a transaction exactly as it would during a standalone call on that entity).
  - Extracts `createEntity`'s mutual-store population into a shared `populateMutualsForCreatedEntity` helper, so an entity created via `executeTransaction` also appears in already-loaded mutual lists — previously only the standalone `createEntity` action did this.
  - Extends `TransactionResultEntry` (`@monorise/core`) with optional `createdAt`/`updatedAt`, populated in `TransactionService`'s `processOperation`, so the client can build a proper `CreatedEntity`-shaped cache row for `createEntity` results and bump timestamps for `updateEntity`/`adjustEntity` results.

## 4.6.0

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

## 4.5.0

### Minor Changes

- 837c455: Add opt-in Athena analytics with schema-generated entity and mutual datasets, durable history, daily current-state materialization, point-in-time backfill, named query API, deployment-managed views, and scheduled Iceberg models.

## 4.4.1

### Patch Changes

- ee44ed4: Return 404 instead of 500 when a named function update condition targets a missing entity.

## 4.4.0

### Minor Changes

- 7a95a4e: Add transactional writes for atomic multi-entity operations

  - `POST /core/transaction` endpoint for atomic multi-entity operations
  - Supports createEntity, updateEntity, adjustEntity, deleteEntity in single DynamoDB TransactWriteItems call
  - All-or-nothing: if any operation fails, entire transaction rolls back
  - Events (ENTITY_CREATED, ENTITY_UPDATED, ENTITY_DELETED) published only after commit succeeds
  - Condition support: adjustmentConditions and updateConditions work within transactions
  - React SDK: `transaction()` function for frontend usage
  - DynamoDB limit enforced: max 100 items per transaction

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

### Patch Changes

- 9d175ef: Fix bugs found while adding entity TTL support:

  - `Mutual#expiresAt` was stored/read as an ISO string, which DynamoDB TTL can't act on (it requires epoch seconds, type `N`). It's now epoch seconds, consistent with `Entity#expiresAt` and the raw lock-writing paths in `Mutual.ts`/`Tag.ts`.
  - `upsertEntity` threw a DynamoDB validation error when called with an `entityId` that had never been created, because the nested `data.<field>` update path requires `data` to already exist as a Map. It now delegates to `createEntity` when the update finds nothing to update, so a brand-new entity created via `upsertEntity` gets the same `LIST#`/`UNIQUE#`/`EMAIL#` replica rows, `uniqueFields` enforcement, and typed ID-collision error as any other newly created entity (previously it would silently create an incomplete, orphaned record).
  - `computeExpiresAt`'s merge-fetch swallowed any error (not just "entity not found") as if the entity didn't exist yet, so a transient DynamoDB error could silently produce a wrong `expiresAt` instead of surfacing. It now only treats the specific not-found case that way and rethrows anything else.
  - `ttl.processor` was always given the current operation's timestamp as `createdAt`, never the entity's true original creation date, so a TTL relative to creation (e.g. "expire 90 days after creation") would silently drift forward on every update. It's now the real `createdAt`.
  - `updateEntity` did up to 3 redundant `GetItem` reads for a single update when both `ttl` and a changed `uniqueFields` value were involved. It now shares one fetch and constructs the returned entity locally instead of re-fetching after a transactional write.
  - For an entity with both `uniqueFields` and `ttl` configured, updating a unique field on an update where `ttl.processor` returns `undefined` wrote the new `UNIQUE#` replica row with no `expiresAt` and returned an entity whose `expiresAt` disagreed with what was actually persisted (the main row correctly retains its previous `expiresAt` in that case). Both now correctly carry over the previous `expiresAt`.

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
