import { createEntityConfig } from '@monorise/base';
import { z } from 'zod';

const baseSchema = z
  .object({
    email: z.string().toLowerCase(),
    displayName: z.string(),
    username: z.string(),
  })
  .partial();

const createSchema = baseSchema.extend({
  email: z.string().toLowerCase(),
  displayName: z.string().min(1, 'Please provide a name for this user account'),
  username: z.string().min(1, 'Please provide a username for this account'),
});

const config = createEntityConfig({
  name: 'admin',
  displayName: 'Admin',
  authMethod: {
    email: {
      tokenExpiresIn: 1000 * 60 * 60 * 24 * 14, // 14 days
    },
  },
  baseSchema,
  createSchema,
  uniqueFields: ['username'],
  searchableFields: ['email', 'displayName'],
});

export default config;
