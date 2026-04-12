import { createEntityConfig } from 'monorise/base';
import { z } from 'zod/v4';
import { Entity } from '../entity';

const baseSchema = z
  .object({
    amount: z.number().int().min(0),
    type: z.enum(['sale', 'refund', 'discount']),
    description: z.string(),
    transactionDate: z.string().datetime(),
    status: z.enum(['pending', 'completed', 'failed']),
    // Denormalized fields for tag processors (mutuals aren't in entity.data)
    merchantId: z.string(),
    buyerId: z.string(),
  })
  .partial();

const createSchema = z.object({
  amount: z.number().int().min(0),
  type: z.enum(['sale', 'refund', 'discount']),
  transactionDate: z.string().datetime(),
  merchantId: z.string(),
  buyerId: z.string(),
  description: z.string().optional(),
  status: z.enum(['pending', 'completed', 'failed']).optional(),
});

const config = createEntityConfig({
  name: 'transaction',
  displayName: 'Transaction',
  baseSchema,
  createSchema,
  searchableFields: ['description'],
  tags: [
    {
      // Query all transactions by date range
      // GET /core/tag/transaction/date?start=2024-01-01&end=2024-12-31
      name: 'date',
      processor: (entity) => [{ sortValue: entity.data.transactionDate }],
    },
    {
      // Query transactions by merchant + date range
      // GET /core/tag/transaction/merchant-date?group={merchantId}&start=...&end=...
      name: 'merchant-date',
      processor: (entity) => {
        if (!entity.data.merchantId) return [];
        return [
          {
            group: entity.data.merchantId,
            sortValue: entity.data.transactionDate,
          },
        ];
      },
    },
    {
      // Query transactions by buyer + date range
      // GET /core/tag/transaction/buyer-date?group={buyerId}&start=...&end=...
      name: 'buyer-date',
      processor: (entity) => {
        if (!entity.data.buyerId) return [];
        return [
          {
            group: entity.data.buyerId,
            sortValue: entity.data.transactionDate,
          },
        ];
      },
    },
    {
      // Filter transactions by type
      // GET /core/tag/transaction/type?group=sale
      name: 'type',
      processor: (entity) => [{ group: entity.data.type }],
    },
  ],
  mutual: {
    mutualSchema: z
      .object({
        merchantIds: z.string().array(),
        buyerIds: z.string().array(),
      })
      .partial(),
    mutualFields: {
      merchantIds: { entityType: Entity.MERCHANT },
      buyerIds: { entityType: Entity.BUYER },
    },
  },
});

export default config;
