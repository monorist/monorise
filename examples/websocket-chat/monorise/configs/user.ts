import { createEntityConfig } from 'monorise/base';
import { z } from 'zod';
import { Entity } from '../entity';

const baseSchema = z
  .object({
    name: z.string(),
    email: z.string().email(),
    avatar: z.string(),
  })
  .partial();

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

const config = createEntityConfig({
  name: 'user',
  displayName: 'User',
  baseSchema,
  createSchema,
  uniqueFields: ['email'],
  searchableFields: ['name'],
});

export default config;
