import { z } from 'zod/v4';
import type { Entity, MonoriseEntityConfig } from '../types/monorise.type';

function makeSchema<
  T extends Entity,
  B extends Partial<Record<never, z.core.SomeType>>,
  C extends Partial<Record<never, z.core.SomeType>>,
  M extends Partial<Record<never, z.core.SomeType>>,
  CO extends z.ZodObject<C> | undefined,
  MO extends z.ZodObject<M> | undefined,
>(config: MonoriseEntityConfig<T, B, C, M, CO, MO>) {
  const { baseSchema, createSchema, mutual } = config;
  const { mutualSchema } = mutual || {};

  const finalSchema = z.object({
    ...baseSchema.shape,
    ...(createSchema ? createSchema.shape : {}),
    ...(mutualSchema ? mutualSchema.shape : {}),
  });

  return finalSchema;
}

const createEntityConfig = <
  T extends Entity,
  B extends Partial<Record<never, z.core.SomeType>>,
  C extends Partial<Record<never, z.core.SomeType>>,
  M extends Partial<Record<never, z.core.SomeType>>,
  CO extends z.ZodObject<C> | undefined,
  MO extends z.ZodObject<M> | undefined,
>(
  config: MonoriseEntityConfig<T, B, C, M, CO, MO>,
) => ({
  ...config,
  finalSchema: makeSchema(config),
});

export { createEntityConfig };
