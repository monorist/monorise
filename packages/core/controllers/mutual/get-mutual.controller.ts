import type { Entity } from '@monorise/base';
import { createMiddleware } from 'hono/factory';
import httpStatus from 'http-status';
import type { MutualRepository } from '../../data/Mutual';
import { StandardError, StandardErrorCode } from '../../errors/standard-error';

export class GetMutualController {
  constructor(private associateRepository: MutualRepository) {}

  controller = createMiddleware(async (c) => {
    const { byEntityType, byEntityId, entityType, entityId } =
      c.req.param() as {
        byEntityType: Entity;
        byEntityId: string;
        entityType: Entity;
        entityId: string;
      };

    try {
      const associate = await this.associateRepository.getMutual(
        byEntityType,
        byEntityId,
        entityType,
        entityId,
      );

      return c.json(associate);
    } catch (err) {
      if (
        err instanceof StandardError &&
        err.code === StandardErrorCode.MUTUAL_IS_UNDEFINED
      ) {
        c.status(httpStatus.NOT_FOUND);
        return c.json({
          code: 'MUTUAL_NOT_FOUND',
          message: 'Mutual not found',
        });
      }

      throw err;
    }
  });
}
