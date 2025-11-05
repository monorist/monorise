import type { Entity } from '@monorise/base';
import { createMiddleware } from 'hono/factory';
import httpStatus from 'http-status';
import type { ZodError } from 'zod';
import { StandardError, StandardErrorCode } from '../../errors/standard-error';
import type { EntityService } from '../../services/entity.service';

export class UpdateEntityController {
  constructor(private entityService: EntityService) {}

  controller = createMiddleware(async (c) => {
    const accountId = c.req.header('account-id');
    const { entityType, entityId } = c.req.param() as {
      entityType: Entity;
      entityId: string;
    };

    const body = await c.req.json();

    const errorContext: any = {
      accountId,
      'req.params': c.req.param(),
      'req.body': body,
    };

    try {
      const entity = await this.entityService.updateEntity({
        entityType,
        entityId,
        entityPayload: body,
        accountId,
      });
      errorContext.entity = entity;

      c.status(httpStatus.OK);
      return c.json(entity);
    } catch (err) {
      if ((err as ZodError).constructor?.name === 'ZodError') {
        c.status(httpStatus.BAD_REQUEST);
        return c.json({
          code: 'API_VALIDATION_ERROR',
          message: 'API validation failed',
          details: (err as ZodError).flatten(),
        });
      }

      if (
        err instanceof StandardError &&
        err.code === StandardErrorCode.ENTITY_NOT_FOUND
      ) {
        c.status(httpStatus.NOT_FOUND);
        return c.json({
          ...err.toJSON(),
        });
      }

      if (
        err instanceof StandardError &&
        err.code === StandardErrorCode.UNIQUE_VALUE_EXISTS
      ) {
        c.status(httpStatus.BAD_REQUEST);
        return c.json({
          ...err.toJSON(),
        });
      }

      console.log(
        '====UPDATE_ENTITY_CONTROLLER_ERROR',
        err,
        JSON.stringify({ errorContext }, null, 2),
      );
      throw err;
    }
  });
}
