import { createEntityConfig } from 'monorise/base';
import { z } from 'zod';
import { Entity } from '../entity';

const baseSchema = z
  .object({
    name: z.string(),
    email: z.string().email(),
  })
  .partial();

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

const config = createEntityConfig({
  name: 'buyer',
  displayName: 'Buyer',
  baseSchema,
  createSchema,
  searchableFields: ['name', 'email'],
  uniqueFields: ['email'],
  mutual: {
    mutualSchema: z
      .object({
        transactionIds: z.string().array(),
      })
      .partial(),
    mutualFields: {
      transactionIds: { entityType: Entity.TRANSACTION },
    },
  },
});

export default config;
