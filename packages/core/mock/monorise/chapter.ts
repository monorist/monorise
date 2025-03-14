import { createEntityConfig } from '@monorise/cli';
import type { Mutual } from '@monorise/react';
import { z } from 'zod';
import { Entity } from '../entity';

export enum CHAPTER_TYPE {
  CHAPTER = 'CHAPTER',
  CUSTOM = 'CUSTOM',
  TOUCHPOINT = 'TOUCHPOINT',
  CHECKPOINT = 'CHECKPOINT',
}

const baseSchema = z
  .object({
    description: z.string(),
    discussionLink: z.string(),
    remark: z.string(),
    type: z.nativeEnum(CHAPTER_TYPE),
    title: z.string(),
    learningActivityDescription: z.string(),
    body: z
      .object({
        type: z.string(),
        id: z.string(),
        content: z.any(),
      })
      .array()
      .optional(),
    progress: z.coerce.number().int(),
  })
  .partial();

const createSchema = baseSchema.extend({
  remark: z.string(),
  type: z.nativeEnum(CHAPTER_TYPE),
});

const mutualSchema = z
  .object({
    learningActivityOrders: z.string().array(),
    referenceOrders: z.string().array(),
    videos: z.string().array().max(1),
  })
  .partial();

const config = createEntityConfig({
  name: 'chapter',
  displayName: 'Chapter',
  baseSchema,
  createSchema,
  searchableFields: ['remark', 'title'],
  mutual: {
    mutualSchema,
    mutualFields: {
      learningActivityOrders: {
        entityType: Entity.LEARNING_ACTIVITY,
        mutualDataProcessor: (
          ids: string[],
          context: Mutual<Entity.CHAPTER, Entity.LEARNING_ACTIVITY>,
        ) => {
          return { index: ids.indexOf(context.entityId) };
        },
      },
      referenceOrders: {
        entityType: Entity.REFERENCE,
        mutualDataProcessor: (
          ids: string[],
          context: Mutual<Entity.CHAPTER, Entity.REFERENCE>,
        ) => {
          return { index: ids.indexOf(context.entityId) };
        },
      },
      videos: {
        entityType: Entity.VIDEO,
      },
    },
  },
  effect: (schema) => {
    return schema.superRefine((value, ctx) => {
      if (
        value.type === CHAPTER_TYPE.CHAPTER &&
        'videos' in value &&
        !value.videos?.length
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Video is required',
          path: ['videos'],
        });
    });
  },
});

export default config;
