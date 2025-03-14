import { createEntityConfig } from '@monorise/cli';
import { z } from 'zod';

const baseSchema = z
  .object({
    label: z.string(),
    link: z.string(),
    prelabel: z.string(),
    postlabel: z.string(),
  })
  .partial();

const createSchema = baseSchema.extend({
  label: z.string().min(1, {
    message: 'Label is required',
  }),
  link: z.string().url('This is not a valid url'),
});

const config = createEntityConfig({
  name: 'reference',
  displayName: 'Reference',
  baseSchema,
  createSchema,
  searchableFields: ['label', 'link', 'prelabel', 'postlabel'],
});

export default config;
