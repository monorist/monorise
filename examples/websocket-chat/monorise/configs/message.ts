import { createEntityConfig } from 'monorise/base';
import { z } from 'zod';
import { Entity } from '../entity';

const baseSchema = z
  .object({
    content: z.string(),
    channelId: z.string(),
    authorId: z.string(),
    authorName: z.string(),
  })
  .partial();

const createSchema = z.object({
  content: z.string().min(1),
  channelId: z.string(),
  authorId: z.string(),
  authorName: z.string(),
});

const config = createEntityConfig({
  name: 'message',
  displayName: 'Message',
  baseSchema,
  createSchema,
  mutual: {
    mutualSchema: z
      .object({
        channelIds: z.string().array(),
      })
      .partial(),
    mutualFields: {
      channelIds: { entityType: Entity.CHANNEL },
    },
  },
});

export default config;
