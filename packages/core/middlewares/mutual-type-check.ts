import type { Entity } from '@monorise/base';
import { createMiddleware } from 'hono/factory';
import httpStatus from 'http-status';
import type { DependencyContainer } from '../services/DependencyContainer';

export const mutualTypeCheck = (container: DependencyContainer) =>
  createMiddleware(async (c, next) => {
    const { entityType, byEntityType } = c.req.param() as {
      entityType: Entity;
      byEntityType: Entity;
    };

    if (
      !container.config.AllowedEntityTypes.includes(entityType) ||
      !container.config.AllowedEntityTypes.includes(byEntityType)
    ) {
      c.status(httpStatus.NOT_FOUND);
      return c.json({
        code: 'NOT_FOUND',
      });
    }

    await next();
  });
