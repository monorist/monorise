import { createEntityConfig } from '@monorise/base';
import { z } from 'zod';
import { Entity } from '../entity';

const baseSchema = z
  .object({
    title: z.string(),
  })
  .partial();

const createSchema = baseSchema.extend({
  title: z.string().min(4, {
    message: 'Title must be at least 4 characters.',
  }),
});

const mutualSchema = z
  .object({
    admins: z.string().array(),
  })
  .partial();

const config = createEntityConfig({
  name: 'course',
  displayName: 'Course',
  baseSchema: baseSchema,
  createSchema,
  searchableFields: ['title'],
  mutual: {
    subscribes: [{ entityType: Entity.ADMIN }],
    mutualSchema,
    mutualFields: {
      admins: {
        entityType: Entity.ADMIN,
        mutualDataProcessor: () => {
          return { index: 1 };
        },
      },
    },

    prejoins: [
      {
        mutualField: 'admins',
        targetEntityType: Entity.ADMIN,
        entityPaths: [
          {
            entityType: Entity.COURSE,
          },
          {
            entityType: Entity.ADMIN,
          },
        ],
      },
    ],
  },
});

export default config;
