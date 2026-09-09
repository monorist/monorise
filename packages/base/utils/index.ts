import { z } from 'zod';
import type {
  Entity,
  MonoriseEntityConfig,
  MutualConfig,
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
      ? z.ZodObject<MO['shape'] & CO['shape']>
      : CO
    : MO extends z.AnyZodObject
      ? z.ZodObject<MO['shape'] & B>
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
  config: MutualConfig<MD>,
) => config;

export { createEntityConfig, createMutualConfig, resolveEffectiveMutualSchema };
