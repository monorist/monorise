import type { Entity } from '@monorise/base';
import { createMiddleware } from 'hono/factory';
import httpStatus from 'http-status';
import { StandardError } from '../../errors/standard-error';
import type { MutualService } from '../../services/mutual.service';

export class UpdateMutualController {
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

    const body = await c.req.json();

    try {
      const mutual = await this.mutualService.updateMutual({
        byEntityType,
        byEntityId,
        entityType,
        entityId,
        mutualPayload: body,
        accountId,
        options: {
          returnUpdatedValue: true,
        },
      });

      return c.json(mutual);
    } catch (err: any) {
      if (err?.constructor?.name === 'ZodError') {
        c.status(httpStatus.BAD_REQUEST);
        return c.json({
          code: 'API_VALIDATION_ERROR',
          message: 'API validation failed',
          details: err.flatten(),
        });
      }

      if (err instanceof StandardError) {
        c.status(httpStatus.BAD_REQUEST);
        return c.json({
          ...err.toJSON(),
        });
      }

      c.status(httpStatus.INTERNAL_SERVER_ERROR);
      return c.json({
        code: 'INTERNAL_SERVER_ERROR',
        message: err?.message || 'An unexpected error occurred',
      });
    }
  });
}