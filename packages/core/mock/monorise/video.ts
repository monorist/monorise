import { createEntityConfig } from '@monorise/cli';
import { z } from 'zod';

const baseSchema = z
  .object({
    title: z.string(),
    categories: z.string().array(),
    additionalFiles: z
      .object({
        type: z.string(),
        id: z.string(),
        content: z.any(),
      })
      .array()
      .optional(),
    keyTakeaway: z.string(),
    remark: z.string(),
    duration: z.number(),
  })
  .partial();

const createSchema = baseSchema.extend({
  title: z.string().min(4, {
    message: 'Title must be at least 4 characters.',
  }),
});

const config = createEntityConfig({
  name: 'video',
  displayName: 'Video',
  baseSchema,
  createSchema,
  searchableFields: ['title', 'remark'],
});

export default config;
