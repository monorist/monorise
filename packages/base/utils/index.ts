import { z } from 'zod';
import type {
  Entity,
  MonoriseEntityConfig,
  MutualConfig,
} from '../types/monorise.type';

function makeSchema<
  T extends Entity,
  B extends z.ZodRawShape,
  C extends z.ZodRawShape,
  M extends z.ZodRawShape,
  CO extends z.ZodObject<C> | undefined = undefined,
  MO extends z.ZodObject<M> | undefined = undefined,
>(config: MonoriseEntityConfig<T, B, C, M, CO, MO>) {
  const { baseSchema, createSchema, mutual, effect } = config;
  const { mutualSchema, createMutualSchema } = mutual || {};
  // finalSchema is only ever consulted on the create path (EntityService.
  // createEntity / TransactionService.buildCreateItems) — never on update —
  // so it's safe to prefer the stricter createMutualSchema here, matching
  // afterCreateEntityHook/collectCreateEvents's own preference below.
  const effectiveMutualSchema = createMutualSchema || mutualSchema;

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
>(
  config: MonoriseEntityConfig<T, B, C, M, CO, MO>,
) => ({
  ...config,
  finalSchema: makeSchema(config),
});

const createMutualConfig = <MD extends z.ZodRawShape>(
  config: MutualConfig<MD>,
) => config;

export { createEntityConfig, createMutualConfig };
