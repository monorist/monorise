import { createEntityConfig } from '@monorise/base';
import { z } from 'zod';

const baseSchema = z
  .object({
    name: z.string(),
    age: z.number(),
  })
  .partial();

const createSchema = baseSchema.extend({
  name: z.string(),
});

const config = createEntityConfig({
  name: 'user',
  displayName: 'User',
  baseSchema,
  createSchema,
});

export default config;
