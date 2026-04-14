export const USER_ENTITY_TEMPLATE = `import { createEntityConfig } from 'monorise/base';
import { z } from 'zod';

const baseSchema = z
  .object({
    displayName: z.string().min(1, 'Display name is required'),
    email: z.string().email('Valid email is required'),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
  })
  .partial();

const createSchema = z.object({
  displayName: z.string().min(1, 'Display name is required'),
  email: z.string().email('Valid email is required'),
});

const config = createEntityConfig({
  name: 'user',
  displayName: 'User',
  baseSchema,
  createSchema,
  searchableFields: ['displayName', 'email'],
  uniqueFields: ['email'],
});

export default config;
`;
