import { createEntityConfig } from 'monorise/base';
import { z } from 'zod';
import { Entity } from '../entity';

const baseSchema = z
  .object({
    name: z.string(),
    description: z.string(),
    createdBy: z.string(),
  })
  .partial();

const createSchema = z.object({
  name: z.string().min(1),
  createdBy: z.string(),
});

const config = createEntityConfig({
  name: 'channel',
  displayName: 'Channel',
  baseSchema,
  createSchema,
  searchableFields: ['name'],
  mutual: {
    mutualSchema: z
      .object({
        messageIds: z.string().array(),
      })
      .partial(),
    mutualFields: {
      messageIds: { entityType: Entity.MESSAGE },
    },
  },
});

export default config;
