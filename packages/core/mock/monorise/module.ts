import { createEntityConfig } from '@monorise/cli';
import type { Mutual } from '@monorise/react';
import { z } from 'zod';
import { Entity } from '../entity';

const allowedTypes = ['MODULE', 'TOUCHPOINT', 'CHECKPOINT'] as const;

const baseSchema = z
  .object({
    title: z.string(),
    description: z.string(),
    shortDescription: z.string(),
    remark: z
      .string()
      .describe('For internal use, eg. This module is for tracks'),
    type: z.enum(allowedTypes),
  })
  .partial();

const createSchema = baseSchema.extend({
  title: z.string(),
  type: z.enum(allowedTypes),
});

const mutualSchema = z
  .object({
    chapterOrders: z.string().array(),
  })
  .partial();

const config = createEntityConfig({
  name: 'module',
  displayName: 'Module',
  baseSchema,
  createSchema,
  searchableFields: ['title'],
  mutual: {
    subscribes: [{ entityType: Entity.CHAPTER }],
    mutualSchema,
    mutualFields: {
      chapterOrders: {
        entityType: Entity.CHAPTER,
        mutualDataProcessor: (
          ids: string[],
          context: Mutual<Entity.MODULE, Entity.CHAPTER>,
        ) => {
          return { index: ids.indexOf(context.entityId) };
        },
      },
      videos: {
        entityType: Entity.VIDEO,
        mutualDataProcessor: (
          ids: string[],
          context: Mutual<Entity.MODULE, Entity.VIDEO>,
          prejoinContext?: Record<string, any>,
        ) => ({
          index: ids.indexOf(context.entityId),
          chapterId: prejoinContext?.[context.entityId],
        }),
      },
      learningActivities: {
        entityType: Entity.LEARNING_ACTIVITY,
        mutualDataProcessor: (
          ids: string[],
          context: Mutual<Entity.MODULE, Entity.LEARNING_ACTIVITY>,
          prejoinContext?: Record<string, any>,
        ) => ({
          index: ids.indexOf(context.entityId),
          chapterId: prejoinContext?.[context.entityId],
        }),
      },
    },
    prejoins: [
      {
        mutualField: 'videos',
        targetEntityType: Entity.VIDEO,
        entityPaths: [
          {
            entityType: Entity.MODULE,
          },
          {
            entityType: Entity.CHAPTER,
          },
          {
            entityType: Entity.VIDEO,
          },
        ],
      },
      {
        mutualField: 'learningActivities',
        targetEntityType: Entity.LEARNING_ACTIVITY,
        entityPaths: [
          {
            entityType: Entity.MODULE,
          },
          {
            entityType: Entity.CHAPTER,
          },
          {
            entityType: Entity.LEARNING_ACTIVITY,
          },
        ],
      },
    ],
  },
});

export default config;
