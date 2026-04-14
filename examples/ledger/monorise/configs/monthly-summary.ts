import { createEntityConfig } from 'monorise/base';
import { z } from 'zod';
import { Entity } from '../entity';

const baseSchema = z
  .object({
    merchantId: z.string(),
    month: z.string(), // YYYY-MM
    totalSales: z.number(),
    totalRefunds: z.number(),
    totalDiscounts: z.number(),
    netTotal: z.number(),
    count: z.number(),
  })
  .partial();

const createSchema = z.object({
  merchantId: z.string(),
  month: z.string(),
  totalSales: z.number().default(0),
  totalRefunds: z.number().default(0),
  totalDiscounts: z.number().default(0),
  netTotal: z.number().default(0),
  count: z.number().default(0),
});

const config = createEntityConfig({
  name: 'monthly-summary',
  displayName: 'Monthly Summary',
  baseSchema,
  createSchema,
  tags: [
    {
      // Query all summaries by date range
      // GET /core/tag/monthly-summary/month?start=2025-09-01&end=2026-03-31
      name: 'month',
      processor: (entity) => [{ sortValue: entity.createdAt }],
    },
    {
      // Query summaries by merchant
      // GET /core/tag/monthly-summary/merchant?group={merchantId}
      name: 'merchant',
      processor: (entity) => {
        if (!entity.data.merchantId) return [];
        return [{ group: entity.data.merchantId }];
      },
    },
  ],
  mutual: {
    mutualSchema: z
      .object({
        merchantIds: z.string().array(),
      })
      .partial(),
    mutualFields: {
      merchantIds: { entityType: Entity.MERCHANT },
    },
  },
});

export default config;
