import { createEntityConfig } from 'monorise/base';
import type { Entity } from 'monorise/base';
import { z } from 'zod';
import teamMembership from '../mutuals/team-membership';

const baseSchema = z
  .object({
    name: z.string().min(1, 'Team name is required'),
  })
  .partial();

const createSchema = z.object({
  name: z.string().min(1, 'Team name is required'),
});

const config = createEntityConfig({
  name: 'team',
  displayName: 'Team',
  baseSchema,
  createSchema,
  searchableFields: ['name'],
  mutual: {
    mutualSchema: z
      .object({
        userIds: z.string().array(),
      })
      .partial(),
    mutualFields: {
      userIds: {
        entityType: 'user' as unknown as Entity,
        mutual: teamMembership,
      },
    },
  },
});

export default config;
