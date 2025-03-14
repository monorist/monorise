import { createEntityConfig } from '@monorise/cli';
import type { Mutual } from '@monorise/react';
import { z } from 'zod';
import { Entity } from '../entity';

const baseSchema = z.object({}).partial();

const mutualSchema = z
  .object({
    courseOrders: z.string().array(),
  })
  .partial();

const config = createEntityConfig({
  name: 'learning-journey-config',
  displayName: 'Learning Journey Config',
  baseSchema,
  mutual: {
    mutualSchema,
    mutualFields: {
      courseOrders: {
        entityType: Entity.COURSE,
        mutualDataProcessor: (
          ids: string[],
          context: Mutual<Entity.LEARNING_JOURNEY_CONFIG, Entity.COURSE>,
        ) => {
          return { index: ids.indexOf(context.entityId) };
        },
      },
    },
  },
});

export default config;
