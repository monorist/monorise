import type { Entity } from '@monorise/base';
import { createMiddleware } from 'hono/factory';
import httpStatus from 'http-status';
import type { EntityRepository } from '../../data/Entity';
import { StandardError, StandardErrorCode } from '../../errors/standard-error';

export class GetEntityByUniqueFieldValueController {
  constructor(private entityRepository: EntityRepository) {}

  controller = createMiddleware(async (c) => {
    const { entityType, uniqueField, uniqueFieldValue } = c.req.param() as {
      entityType: Entity;
      uniqueField: string;
      uniqueFieldValue: string;
    };

    try {
      const entity = await this.entityRepository.getEntityByUniqueField(
        entityType,
        uniqueField,
        uniqueFieldValue,
      );

      return c.json(entity);
    } catch (err) {
      if (
        err instanceof StandardError &&
        err.code === StandardErrorCode.ENTITY_IS_UNDEFINED
      ) {
        c.status(httpStatus.NOT_FOUND);
        return c.json({
          code: 'ENTITY_NOT_FOUND',
          message: 'Entity not found',
        });
      }

      throw err;
    }
  });
}
