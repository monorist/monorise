import type { Entity } from '@monorise/base';
import { createMiddleware } from 'hono/factory';
import httpStatus from 'http-status';
import type { ZodError } from 'zod';
import { StandardError, StandardErrorCode } from '../../errors/standard-error';
import type { EntityService } from '../../services/entity.service';

export class CreateEntityController {
  constructor(private entityService: EntityService) {}

  controller = createMiddleware(async (c) => {
    const accountId = c.req.header('account-id');
    const { entityType } = c.req.param() as {
      entityType: Entity;
    };

    const body = await c.req.json();

    try {
      const entity = await this.entityService.createEntity({
        entityType,
        entityPayload: body,
        accountId,
        options: {
          createAndUpdateDatetime: body.createdAt,
        },
      });

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
        err.code === StandardErrorCode.EMAIL_EXISTS
      ) {
        c.status(httpStatus.BAD_REQUEST);
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

      console.log('===create-entity error:', {
        err,
        errorContext: JSON.stringify({
          body,
          headers: c.req.header(),
        }),
      });

      throw err;
    }
  });
}
