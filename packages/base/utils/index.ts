import type { Entity, MonoriseEntityConfig } from '../types/monorise.type';
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
    ...mutualSchema?.shape,
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

export { createEntityConfig };
