import { createEntityConfig } from '@monorise/cli';
import type { Mutual } from '@monorise/react';
import { z } from 'zod';
import { Entity } from '../entity';

const baseSchema = z
  .object({
    title: z.string(),
    categories: z.string().array(),
    duration: z.number(),
    description: z.string(),
    learningOutcomes: z.string().array(),
    infographics: z.string().array(),
    tags: z.string().array(),
  })
  .partial();

const createSchema = baseSchema.extend({
  title: z.string().min(4, {
    message: 'Title must be at least 4 characters.',
  }),
});

const mutualSchema = z
  .object({
    moduleOrders: z.string().array(),
    videos: z.string().array(),
    chapters: z.string().array(),
    learningActivities: z.string().array(),
  })
  .partial();

const config = createEntityConfig({
  name: 'course',
  displayName: 'Course',
  baseSchema: baseSchema,
  createSchema,
  searchableFields: ['title'],
  mutual: {
    subscribes: [{ entityType: Entity.MODULE }],
    mutualSchema,
    mutualFields: {
      moduleOrders: {
        entityType: Entity.MODULE,
        mutualDataProcessor: (
          ids: string[],
          context: Mutual<Entity.COURSE, Entity.MODULE>,
        ) => {
          return { index: ids.indexOf(context.entityId) };
        },
      },
      videos: {
        entityType: Entity.VIDEO,
        mutualDataProcessor: (
          ids: string[],
          context: Mutual<Entity.COURSE, Entity.VIDEO>,
          prejoinContext?: Record<string, any>,
        ) => {
          return {
            index: ids.indexOf(context.entityId),
            moduleId: prejoinContext?.[context.entityId],
          };
        },
      },
      chapters: {
        entityType: Entity.CHAPTER,
        mutualDataProcessor: (
          ids: string[],
          context: Mutual<Entity.COURSE, Entity.CHAPTER>,
          prejoinContext?: Record<string, any>,
        ) => ({
          index: ids.indexOf(context.entityId),
          moduleId: prejoinContext?.[context.entityId],
        }),
      },
      learningActivities: {
        entityType: Entity.LEARNING_ACTIVITY,
        mutualDataProcessor: (
          ids: string[],
          context: Mutual<Entity.COURSE, Entity.LEARNING_ACTIVITY>,
          prejoinContext?: Record<string, any>,
        ) => {
          return {
            index: ids.indexOf(context.entityId),
            moduleId: prejoinContext?.[context.entityId],
          };
        },
      },
    },

    prejoins: [
      {
        mutualField: 'chapters',
        targetEntityType: Entity.CHAPTER,
        entityPaths: [
          {
            entityType: Entity.COURSE,
          },
          {
            entityType: Entity.MODULE,
          },
          {
            entityType: Entity.CHAPTER,
          },
        ],
      },
      {
        mutualField: 'videos',
        targetEntityType: Entity.VIDEO,
        entityPaths: [
          {
            entityType: Entity.COURSE,
          },
          {
            entityType: Entity.MODULE,
          },
          {
            skipCache: true,
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
            entityType: Entity.COURSE,
          },
          {
            entityType: Entity.MODULE,
          },
          {
            skipCache: true,
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
