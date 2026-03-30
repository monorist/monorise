import type { Entity } from '@monorise/base';
import { createMiddleware } from 'hono/factory';
import httpStatus from 'http-status';
import { StandardError, StandardErrorCode } from '../../errors/standard-error';
import type { EntityService } from '../../services/entity.service';

export class AdjustEntityController {
  constructor(private entityService: EntityService) {}

  controller = createMiddleware(async (c) => {
    const accountId = c.req.header('account-id') || '';
    const { entityType, entityId } = c.req.param() as {
      entityType: Entity;
      entityId: string;
    };

    const body = await c.req.json();

    // Validate all values are numbers
    for (const [key, value] of Object.entries(body)) {
      if (typeof value !== 'number') {
        c.status(httpStatus.BAD_REQUEST);
        return c.json({
          code: 'API_VALIDATION_ERROR',
          message: `Field "${key}" must be a number, got ${typeof value}`,
        });
      }
    }

    try {
      const entity = await this.entityService.adjustEntity({
        entityType,
        entityId,
        adjustments: body,
        accountId,
      });

      c.status(httpStatus.OK);
      return c.json(entity.toJSON());
    } catch (err: any) {
      if (
        err instanceof StandardError &&
        err.code === StandardErrorCode.ENTITY_IS_UNDEFINED
      ) {
        c.status(httpStatus.NOT_FOUND);
        return c.json({ ...err.toJSON() });
      }

      // DynamoDB ConditionalCheckFailedException — constraint violated
      if (err?.name === 'ConditionalCheckFailedException' || err?.__type?.includes('ConditionalCheckFailed')) {
        c.status(httpStatus.CONFLICT);
        return c.json({
          code: 'ADJUSTMENT_CONSTRAINT_VIOLATED',
          message: 'Adjustment would violate entity constraints',
        });
      }

      console.log('====ADJUST_ENTITY_CONTROLLER_ERROR', err);
      throw err;
    }
  });
}
