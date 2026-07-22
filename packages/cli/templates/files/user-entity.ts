import { createEntityConfig } from 'monorise/base';
import type { Entity } from 'monorise/base';
import { z } from 'zod';
import teamMembership from '../mutuals/team-membership';

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
  // Example mutual relationship — see monorise/mutuals/team-membership.ts
  mutual: {
    mutualSchema: z
      .object({
        teamIds: z.string().array(),
      })
      .partial(),
    mutualFields: {
      teamIds: {
        entityType: 'team' as unknown as Entity,
        mutual: teamMembership,
      },
    },
  },
});

export default config;
