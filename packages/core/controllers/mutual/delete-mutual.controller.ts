import type { Entity } from '@monorise/base';
import { createMiddleware } from 'hono/factory';
import httpStatus from 'http-status';
import { StandardError, StandardErrorCode } from '../../errors/standard-error';
import type { MutualService } from '../../services/mutual.service';

export class DeleteMutualController {
  constructor(private mutualService: MutualService) {}

  controller = createMiddleware(async (c) => {
    const accountId = c.req.header('account-id');
    const { byEntityType, byEntityId, entityType, entityId } =
      c.req.param() as {
        byEntityType: Entity;
        byEntityId: string;
        entityType: Entity;
        entityId: string;
      };

    try {
      const mutual = await this.mutualService.deleteMutual({
        byEntityType,
        byEntityId,
        entityType,
        entityId,
        accountId,
      });

      return c.json(mutual);
    } catch (err) {
      if (
        err instanceof StandardError &&
        err.code === StandardErrorCode.MUTUAL_NOT_FOUND
      ) {
        c.status(httpStatus.BAD_REQUEST);
        return c.json({
          ...err.toJSON(),
        });
      }

      throw err;
    }
  });
}
