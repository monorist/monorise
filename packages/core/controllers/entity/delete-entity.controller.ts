import type { Entity } from '@monorise/base';
import { createMiddleware } from 'hono/factory';
import httpStatus from 'http-status';
import { StandardError, StandardErrorCode } from '../../errors/standard-error';
import type { EntityService } from '../../services/entity.service';

export class DeleteEntityController {
  constructor(private readonly entityService: EntityService) {}

  controller = createMiddleware(async (c) => {
    const accountId = c.req.header('account-id');
    const { entityType, entityId } = c.req.param() as {
      entityType: Entity;
      entityId: string;
    };

    try {
      await this.entityService.deleteEntity({
        entityType,
        entityId,
        accountId,
      });

      return c.json({ message: 'entity deleted' });
    } catch (err) {
      if (
        err instanceof StandardError &&
        err.code === StandardErrorCode.ENTITY_NOT_FOUND
      ) {
        c.status(httpStatus.NOT_FOUND);
        return c.json({
          ...err.toJSON(),
        });
      }

      throw err;
    }
  });
}
