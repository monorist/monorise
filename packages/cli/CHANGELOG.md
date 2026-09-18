# @monorise/cli

## 4.3.0

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

## 4.2.0

### Minor Changes

- 837c455: Add opt-in Athena analytics with schema-generated entity and mutual datasets, durable history, daily current-state materialization, point-in-time backfill, named query API, deployment-managed views, and scheduled Iceberg models.

## 4.1.2

### Patch Changes

- 90a45e2: Generate an application-owned `X_API_KEY` secret for backend proxies instead of embedding the selected Core API key in the Next.js environment.

## 4.1.1

### Patch Changes

- 90e7486: Release CLI custom route generation fixes in the unified package.

## 4.1.0

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

## 4.0.0

### Major Changes

- e6a935f: Upgrade to SST v4

  - Bumped `sst` peer dependency from `^3.16.3` to `4.7.3`
  - Fixed internal type leak in `QFunction` that referenced `.sst/platform` paths
  - Updated `examples/basic` to use SST v4 and the unified `monorise` package
  - Added migration guide at `docs/MIGRATE-SST-V4.md`

## 3.0.3

### Patch Changes

- b59075f: Fix combined package DTS rewriting and CLI monorepo detection

  - build.js: Fix regex that missed rewriting some `@monorise/*` imports in `.d.ts` files (global regex `lastIndex` bug + missing double-quote patterns)
  - cli: Add `detectCombinedPackage()` that walks up directory tree for monorepo hoisting support, and generate correct module augmentation based on detection

## 3.0.3-dev.0

### Patch Changes

- b59075f: Fix combined package DTS rewriting and CLI monorepo detection

  - build.js: Fix regex that missed rewriting some `@monorise/*` imports in `.d.ts` files (global regex `lastIndex` bug + missing double-quote patterns)
  - cli: Add `detectCombinedPackage()` that walks up directory tree for monorepo hoisting support, and generate correct module augmentation based on detection

## 3.0.2

### Patch Changes

- 7a29b6a: Add module augmentation for monorise/base combined package to fix type resolution
- 7a29b6a: include handle @

## 3.0.2-dev.1

### Patch Changes

- 37193cc: include handle @

## 3.0.2-dev.0

### Patch Changes

- eeb410d: Add module augmentation for monorise/base combined package to fix type resolution

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

### Patch Changes

- 9c0dcaf: fix: Provide a default typing for EmailAuthEnabledEntities
- a83462f: update:

  - sst: support `configRoot`
  - sst: piggyback fix tsconfig.json indefinite loop when build
  - sst: comment out unused send alarm handler
  - cli: support `--config-root`
  - cli: piggyback fix tsconfig.json indefinite loop when build

- b642115: fix: monorise.config.ts read path inconsistency
  chore: help manual update to --config-root
- c3609ab: feat: dependency container access from custom route

## 1.0.0-dev.3

### Patch Changes

- 9c0dcaf: fix: Provide a default typing for EmailAuthEnabledEntities

## 1.0.0-dev.2

### Patch Changes

- b642115: fix: monorise.config.ts read path inconsistency
  chore: help manual update to --config-root
- c3609ab: feat: dependency container access from custom route

## 1.0.0-dev.1

### Patch Changes

- a83462f: update:

  - sst: support `configRoot`
  - sst: piggyback fix tsconfig.json indefinite loop when build
  - sst: comment out unused send alarm handler
  - cli: support `--config-root`
  - cli: piggyback fix tsconfig.json indefinite loop when build

## 1.0.0-dev.0

### Major Changes

- 54beb03: monorise to support sst v3

## 0.1.0

### Minor Changes

- c9bbbd9: add cli dev mode

## 0.0.2

### Patch Changes

- 83579b5: Remove export of createEntityConfig
- 83579b5: monorise cli generate an export default config object
- 83579b5: EntitySchemaMap should be using Entity enum as key

## 0.0.2-dev.2

### Patch Changes

- c8c3a45: EntitySchemaMap should be using Entity enum as key

## 0.0.2-dev.1

### Patch Changes

- 9200378: Remove export of createEntityConfig

## 0.0.2-dev.0

### Patch Changes

- 0e87cb0: monorise cli generate an export default config object

## 0.0.1

### Patch Changes

- d228c47: setup changesets

## 0.0.1-dev.0

### Patch Changes

- d228c47: setup changesets
