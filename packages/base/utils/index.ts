import type { Entity, MonoriseEntityConfig } from '@monorise/base';
import { z } from 'zod';

function makeSchema<
  T extends Entity,
  B extends z.ZodRawShape,
  C extends z.ZodRawShape,
  M extends z.ZodRawShape,
  CO extends z.ZodObject<C> | undefined = undefined,
  MO extends z.ZodObject<M> | undefined = undefined,
>(config: MonoriseEntityConfig<T, B, C, M, CO, MO>) {
  const { baseSchema, createSchema, mutual, effect } = config;
  const { mutualSchema } = mutual || {};

  const finalSchema = z.object({
    ...baseSchema.shape,
    ...createSchema?.shape,
    ...mutualSchema?.shape,
  }) as CO extends z.AnyZodObject
    ? MO extends z.AnyZodObject
      ? z.ZodObject<MO['shape'] & CO['shape']>
      : CO
    : MO extends z.AnyZodObject
      ? z.ZodObject<MO['shape'] & B>
      : z.ZodObject<B>;

  if (effect) {
    return effect(finalSchema);
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

export { createEntityConfig };
