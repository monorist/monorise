import { createEntityConfig } from '@monorise/cli';
import { z } from 'zod';

const baseSchema = z
  .object({
    email: z.string().toLowerCase(),
    displayName: z.string(),
  })
  .partial();

const createSchema = baseSchema.extend({
  email: z
    .string()
    .toLowerCase()
    .regex(
      /^[a-zA-Z0-9.!#$%&’*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/,
      "Doesn't seems like an email",
    ),
  displayName: z.string().min(1, 'Please provide a name for this user account'),
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
  searchableFields: ['email', 'displayName'],
});

export default config;
