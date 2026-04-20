import { createEntityConfig } from 'monorise/base';
import { z } from 'zod';

const baseSchema = z
  .object({
    name: z.string(),
    balance: z.number(),
  })
  .partial();

const createSchema = z.object({
  name: z.string().min(1),
  balance: z.number().default(0),
});

const config = createEntityConfig({
  name: 'wallet',
  displayName: 'Wallet',
  baseSchema,
  createSchema,
  conditions: {
    withdraw: (data, adjustments) => ({
      balance: { $gte: Math.abs(adjustments?.balance ?? 0) },
    }),
    deposit: { balance: { $lte: 1000000 } },
  },
});

export default config;
