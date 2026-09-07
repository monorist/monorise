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
function resolveEffectiveMutualSchema<
  M extends z.AnyZodObject | undefined,
>(
  mutualSchema: M,
  createMutualSchema?: z.AnyZodObject,
): M extends z.AnyZodObject ? z.AnyZodObject : z.AnyZodObject | undefined {
  if (!createMutualSchema) return mutualSchema as any;
  if (!mutualSchema) return createMutualSchema as any;

  return z.object({
    ...mutualSchema.shape,
    ...createMutualSchema.shape,
  }) as any;
}

function makeSchema<
  T extends Entity,
  B extends z.ZodRawShape,
  C extends z.ZodRawShape,
  M extends z.ZodRawShape,
  CO extends z.ZodObject<C> | undefined = undefined,
  MO extends z.ZodObject<M> | undefined = undefined,
  CMO extends z.AnyZodObject | undefined = undefined,
>(config: MonoriseEntityConfig<T, B, C, M, CO, MO, CMO>) {
  const { baseSchema, createSchema, mutual, effect } = config;
  const { mutualSchema, createMutualSchema } = mutual || {};
  // finalSchema is only ever consulted on the create path (EntityService.
  // createEntity / TransactionService.buildCreateItems) — never on update —
  // so it's safe to prefer the stricter createMutualSchema here, matching
  // afterCreateEntityHook/collectCreateEvents's own preference below.
  const effectiveMutualSchema = resolveEffectiveMutualSchema(
    mutualSchema,
    createMutualSchema,
  );

  // Mirrors resolveEffectiveMutualSchema's runtime merge at the type level:
  // when createMutualSchema is defined, its (stricter) field types combine
  // with mutualSchema's, so a create-required mutual field is reflected as
  // required here too — otherwise EntitySchemaMap would mark it optional
  // while finalSchema.parse() rejects a payload that omits it.
  type EffectiveMutualShape = MO extends z.AnyZodObject
    ? CMO extends z.AnyZodObject
      ? MO['shape'] & CMO['shape']
      : MO['shape']
    : CMO extends z.AnyZodObject
      ? CMO['shape']
      : // biome-ignore lint/complexity/noBannedTypes: intentional empty-shape fallback, mirrors the `z.ZodObject<B>` "no mutual" branch below
        {};

  type FinalSchemaType = CO extends z.AnyZodObject
    ? z.ZodObject<EffectiveMutualShape & CO['shape']>
    : z.ZodObject<EffectiveMutualShape & B>;

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
) => ({
  ...config,
  finalSchema: makeSchema(config),
});

const createMutualConfig = <MD extends z.ZodRawShape>(
  config: MutualConfig<MD>,
) => config;

export {
  createEntityConfig,
  createMutualConfig,
  resolveEffectiveMutualSchema,
};
