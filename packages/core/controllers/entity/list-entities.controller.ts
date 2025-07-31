import type { Entity } from '@monorise/base';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import type { EntityRepository } from '../../data/Entity';

const querySchema = z.object({
  limit: z.string().optional(),
  lastKey: z.string().optional(),
  query: z.string().trim().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
});

export class ListEntitiesController {
  constructor(private entityRepository: EntityRepository) {}

  controller = createMiddleware(async (c) => {
    const errorContext: { [key: string]: any } = {};
    try {
      const accountId = c.req.header('account-id') || '';
      if (Array.isArray(accountId)) {
        throw new Error('multiple account-id detected');
      }

      const params = c.req.param();
      const queries = c.req.query();

      errorContext.accountId = accountId;
      errorContext.params = params;
      errorContext.query = queries;

      const { entityType } = params as {
        entityType: Entity;
      };

      const { lastKey, query, limit, start, end } = querySchema.parse(queries);
      if (query) {
        const results = await this.entityRepository.queryEntities(
          entityType,
          query,
        );

        return c.json({
          data: results.items.map((item) => item.toJSON()),
          totalCount: results.totalCount,
          filteredCount: results.filteredCount,
        });
      }

      const results = await this.entityRepository.listEntities({
        entityType,
        limit: Number(limit),
        options: {
          lastKey,
        },
        ...(start && end ? { between: { start, end } } : {}),
      });
      return c.json({
        data: results.items.map((item) => item.toJSON()),
        totalCount: results.totalCount,
        lastKey: results.lastKey,
      });
    } catch (error) {
      console.log({ error, errorContext });
      c.status(500);
      return c.json({ message: error });
    }
  });
}
