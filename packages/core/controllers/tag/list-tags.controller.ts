import type { Entity } from '@monorise/base';
import { createMiddleware } from 'hono/factory';
import httpStatus from 'http-status';
import { z } from 'zod';
import type { TagRepository } from '../../data/Tag';

const querySchema = z.object({
  group: z.string().optional(),
  query: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  limit: z.string().optional(),
  lastKey: z.string().optional(),
});

export class ListTagsController {
  constructor(private tagRepository: TagRepository) {}

  controller = createMiddleware(async (c) => {
    const errorContext: Record<string, unknown> = {};
    try {
      errorContext.params = c.req.param();
      errorContext.query = c.req.query();

      const { entityType, tagName } = c.req.param() as {
        entityType: Entity;
        tagName: string;
      };

      const { lastKey, query, limit, start, end, group } = querySchema.parse(
        c.req.query(),
      );

      const results = await this.tagRepository.listTags({
        entityType,
        tagName,
        limit: Number(limit),
        options: {
          lastKey,
        },
        query,
        group,
        start,
        end,
      });
      return c.json({
        entities: results.items.map((item) => item.toJSON()),
        totalCount: results.totalCount,
        lastKey: results.lastKey,
      });
    } catch (error) {
      console.log({ error, errorContext });
      c.status(httpStatus.INTERNAL_SERVER_ERROR);
      return c.json({ message: error });
    }
  });
}
