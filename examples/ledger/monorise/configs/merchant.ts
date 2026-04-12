import { createEntityConfig } from 'monorise/base';
import { z } from 'zod/v4';
import { Entity } from '../entity';

const baseSchema = z
  .object({
    name: z.string(),
    category: z.string(),
    contactEmail: z.string().email(),
  })
  .partial();

const createSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  contactEmail: z.string().email(),
});

const config = createEntityConfig({
  name: 'merchant',
  displayName: 'Merchant',
  baseSchema,
  createSchema,
  searchableFields: ['name'],
  tags: [
    {
      name: 'category',
      processor: (entity) => [{ group: entity.data.category }],
    },
  ],
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
