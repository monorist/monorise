import { z } from 'zod';
import type {
  Entity,
  MonoriseEntityConfig,
  MutualConfig,
  MutualConfigInput,
} from '../types/monorise.type';

/**
 * @description Merges `mutualSchema` and `createMutualSchema` into the schema
 * actually used to validate a create payload. A plain `createMutualSchema ||
 * mutualSchema` fallback would DROP any mutual field that's declared on
 * `mutualSchema` but omitted from `createMutualSchema` (e.g. a
 * `createMutualSchema` authored to cover only the newly-required field,
 * without repeating every other optional mutual field) — `.parse()` strips
 * unknown keys, so that field's wiring would silently never fire even when
 * the caller supplied it. Merging shapes (with `createMutualSchema`'s keys
 * taking precedence on overlap, since it's the stricter one) keeps every
 * mutual field in play while still enforcing the create-only requirement.
 */
function resolveEffectiveMutualSchema<M extends z.AnyZodObject | undefined>(
  mutualSchema: M,
  createMutualSchema?: z.AnyZodObject,
): M extends z.AnyZodObject ? z.AnyZodObject : z.AnyZodObject | undefined {
  if (!createMutualSchema) return mutualSchema as any;
  if (!mutualSchema) return createMutualSchema as any;

  return mutualSchema.merge(createMutualSchema) as any;
}

function makeSchema<
  T extends Entity,
  B extends z.ZodRawShape,
  C extends z.ZodRawShape,
  M extends z.ZodRawShape,
  CO extends z.ZodObject<C> | undefined = undefined,
  MO extends z.ZodObject<M> | undefined = undefined,
  CMO extends z.AnyZodObject | undefined = undefined,
>(
  config: MonoriseEntityConfig<T, B, C, M, CO, MO, CMO>,
  effectiveMutualSchema: z.AnyZodObject | undefined,
) {
  const { baseSchema, createSchema, effect } = config;

  // Deliberately NOT `MO & CMO`-typed: finalSchema.parse() runs against
  // effectiveMutualSchema's real runtime shape (below), but EntitySchemaMap
  // — the type callers see back from a *read* — is generated from this
  // same FinalSchemaType (packages/cli/commands/utils/generate.ts). Mutual
  // fields are never stored, so a required createMutualSchema field must
  // stay optional here; only the create-path runtime validation is allowed
  // to be strict.
  type FinalSchemaType = CO extends z.AnyZodObject
    ? MO extends z.AnyZodObject
      ? z.ZodObject<B & CO['shape'] & MO['shape']>
      : z.ZodObject<B & CO['shape']>
    : MO extends z.AnyZodObject
      ? z.ZodObject<B & MO['shape']>
      : z.ZodObject<B>;

  const finalSchema = z.object({
    ...baseSchema.shape,
    ...createSchema?.shape,
    ...effectiveMutualSchema?.shape,
  }) as FinalSchemaType;

  if (effect) {
    return effect(finalSchema) as z.ZodEffects<FinalSchemaType>;
  }

  return finalSchema;
}

const createEntityConfig = <
  T extends Entity,
  B extends z.ZodRawShape,
  C extends z.ZodRawShape,
  M extends z.ZodRawShape,
  CO extends z.ZodObject<C> | undefined = undefined,
  MO extends z.ZodObject<M> | undefined = undefined,
  CMO extends z.AnyZodObject | undefined = undefined,
>(
  config: MonoriseEntityConfig<T, B, C, M, CO, MO, CMO>,
) => {
  // Computed once here (config-definition time, not per-request/per-item)
  // and reused by every create-path call site (afterCreateEntityHook,
  // TransactionService.collectCreateEvents, UpsertEntityController) instead
  // of each rebuilding the same merged ZodObject from scratch.
  const { mutualSchema, createMutualSchema } = config.mutual || {};
  const effectiveMutualSchema = resolveEffectiveMutualSchema(
    mutualSchema,
    createMutualSchema,
  );

  return {
    ...config,
    // Derived output, not an input on MonoriseEntityConfig — there's
    // nowhere to declare this on the config type itself. Read by name
    // across packages/core (EntityServiceLifeCycle, TransactionService,
    // UpsertEntityController); don't hand-set it on a config object built
    // outside this factory (e.g. a test fixture) — build through
    // createEntityConfig instead, or it silently falls out of sync with
    // mutual.mutualSchema/createMutualSchema.
    effectiveMutualSchema,
    finalSchema: makeSchema(config, effectiveMutualSchema),
  };
};

const createMutualConfig = <MD extends z.ZodRawShape>(
  config: MutualConfigInput<MD>,
): MutualConfig<MD> => {
  // Catches a specific footgun before it falls through to the generic
  // "one of mutualDataSchema or asEntity is required" error below: a config
  // module that does `asEntity: importedEntityConfig` where
  // `importedEntityConfig` comes from a circular import (e.g. student.ts
  // imports enrollmentEntityConfig, which itself lives in a module that
  // imports student.ts) evaluates to `undefined` at this point, not a
  // missing key — `'asEntity' in config` is true, `config.asEntity` is not.
  // The generic error below would say "one of ... is required", which sends
  // people looking for a typo instead of an import cycle.
  if ('asEntity' in config && config.asEntity === undefined) {
    throw new Error(
      "createMutualConfig: 'asEntity' is undefined — likely a circular import between entity config files (the imported entity config module hasn't finished initializing yet). Restructure the imports to break the cycle.",
    );
  }

  if (config.asEntity && config.mutualDataSchema) {
    throw new Error(
      "createMutualConfig: 'asEntity' and 'mutualDataSchema' are mutually exclusive. " +
        "When 'asEntity' is set, mutualDataSchema is derived automatically from " +
        "asEntity.finalSchema — remove the explicit mutualDataSchema (or drop 'asEntity' " +
        'if this mutual should keep its own independently-authored schema).',
    );
  }

  if (!config.asEntity && !config.mutualDataSchema) {
    throw new Error(
      "createMutualConfig: one of 'mutualDataSchema' or 'asEntity' is required.",
    );
  }

  // Unchanged identity behavior when `asEntity` isn't set — existing configs are unaffected.
  // `mutualDataSchema` is guaranteed present here (checked above), so this cast just tells
  // TypeScript what the runtime guard already established.
  if (!config.asEntity) return config as MutualConfig<MD>;

  // `finalSchema` (not baseSchema/createSchema alone) on purpose: the declarative mutual
  // processor's `afterCreateEntityHook` call needs the full schema to correctly wire the
  // synthetic entity's own further `mutualFields` too (see mutual-processor.ts).
  //
  // This does NOT mean finalSchema-shaped data is what gets PERSISTED as this mutual's
  // `mutualData` or the synthetic entity's `data` — both `MutualService.createMutual` and
  // `mutual-processor.ts` re-derive a narrower `asEntity.createSchema ?? asEntity.baseSchema`
  // parse for anything actually written to storage, specifically so the target entity's own
  // mutual-field keys (e.g. `courseIds`, if the target entity itself declares `mutualFields`)
  // never get baked into stored data — the same "mutual fields are never stored" invariant
  // `makeSchema` already documents for ordinary entities. `mutualDataSchema` staying as
  // `finalSchema` is what makes the fuller shape available to whichever call site needs it for
  // hook-wiring purposes, without that fuller shape leaking into what's actually persisted.
  return {
    ...config,
    mutualDataSchema: config.asEntity.finalSchema as unknown as z.ZodObject<MD>,
  };
};

export { createEntityConfig, createMutualConfig, resolveEffectiveMutualSchema };
