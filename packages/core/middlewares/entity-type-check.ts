import type { Entity } from '@monorise/base';
import { createMiddleware } from 'hono/factory';
import httpStatus from 'http-status';
import type { DependencyContainer } from '../services/DependencyContainer';

export const entityTypeCheck = (container: DependencyContainer) =>
  createMiddleware(async (c, next) => {
    const { entityType } = c.req.param() as { entityType: Entity };

    if (!container.config.AllowedEntityTypes.includes(entityType)) {
      c.status(httpStatus.NOT_FOUND);
      return c.json({
        code: 'NOT_FOUND',
      });
    }

    await next();
  });
