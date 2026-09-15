---
"@monorise/base": minor
"@monorise/core": minor
"@monorise/cli": minor
"monorise": minor
---

Add optional `asEntity` to `createMutualConfig`, letting a mutual relationship declare — once, on the config itself — that it should also be materialized as a first-class `Entity`.

Previously, `asEntity`/`ensureEntityStrongConsistentWrite` were only available as ad-hoc options passed at each imperative `MutualService.createMutual(...)` call site. Most real usage doesn't call `createMutual` imperatively at all: entity configs wire relationships declaratively via `mutualFields`, and monorise's own lifecycle hooks call `createMutual` on the engineer's behalf under the hood — with no way to opt a declaratively-wired mutual into `asEntity` behavior short of hand-rolling an imperative call and losing the `mutualFields` DX.

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
  ensureEntityStrongConsistentWrite: true, // default false
});
```

When `asEntity` is set, `mutualDataSchema` must be **omitted** — it's derived automatically from `asEntity.finalSchema` (that entity's own `baseSchema` + `createSchema` + `effectiveMutualSchema`, merged — the same schema this codebase already validates every normal `createEntity` payload against), so the mutual's data shape can never drift from the materialized entity's own shape. `finalSchema` (rather than a narrower `baseSchema`/`createSchema`-only derivation) is used deliberately: `MutualService.createMutual`'s `asEntity` path fires `afterCreateEntityHook` on the synthetic entity — the same hook that wires up an entity's own further `mutualFields` — so anything narrower would silently break that wiring for any `asEntity`-targeted entity that itself declares further relationships. Providing both `asEntity` and `mutualDataSchema` on the same config is a hard error, enforced both when `createMutualConfig` is called (fails fast at config-definition time) and at `monorise build`/`generate` time (catches a hand-rolled `MutualConfig` object that bypasses the factory).

Every place monorise resolves this mutual config into a `createMutual` call — the imperative `MutualService.createMutual`, and the async processor that fires for declarative `mutualFields` entries — now automatically also creates a real `Entity` (`entityType: asEntity.name`, `entityId: <the mutual's own ulid>`, `data: <the mutual's own parsed mutualData>`), so the relationship can be looked up via monorise's indexed `tags` mechanism instead of scanning and filtering every edge in application code. `ensureEntityStrongConsistentWrite: true` creates that entity synchronously in the same DynamoDB transaction as the mutual write and fires its `afterCreateEntityHook` immediately; `false`/omitted (default) publishes an async `CREATE_ENTITY` event instead — matching `MutualService.createMutual`'s existing options of the same name.

An explicit `options.asEntity`/`options.ensureEntityStrongConsistentWrite` passed directly at an imperative `createMutual(...)` call site always takes precedence over the config-level value — existing imperative callers are completely unaffected. A mutual config that doesn't set `asEntity` behaves exactly as before.
