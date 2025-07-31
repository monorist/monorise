import type { Entity, createEntityConfig } from '@monorise/base';
import { createMiddleware } from 'hono/factory';
import httpStatus from 'http-status';
import { ZodError } from 'zod';
import type { EntityRepository } from '../../data/Entity';
import { StandardError, StandardErrorCode } from '../../errors/standard-error';
import type { publishEvent as publishEventType } from '../../helpers/event';
import { EVENT } from '../../types/event';

export class UpsertEntityController {
  constructor(
    private EntityConfig: Record<Entity, ReturnType<typeof createEntityConfig>>,
    private entityRepository: EntityRepository,
    private publishEvent: typeof publishEventType,
  ) {}

  controller = createMiddleware(async (c) => {
    const accountId = c.req.header('account-id');
    const { entityType, entityId } = c.req.param() as {
      entityType: Entity;
      entityId: string;
    };

    try {
      const entitySchema =
        this.EntityConfig[entityType].createSchema ||
        this.EntityConfig[entityType].baseSchema;
      const mutualSchema = this.EntityConfig[entityType].mutual?.mutualSchema;

      if (!entitySchema || !mutualSchema) {
        throw new StandardError(
          StandardErrorCode.INVALID_ENTITY_TYPE,
          'Invalid entity type',
        );
      }

      const body = await c.req.json();

      const parsedEntityPayload = entitySchema.parse(body);
      const parsedMutualPayload = mutualSchema.parse(body);

      const entity = await this.entityRepository.upsertEntity(
        entityType,
        entityId,
        parsedEntityPayload,
      );

      if (parsedMutualPayload) {
        const byEntityType = entityType;
        const byEntityId = entity.entityId;
        const publishEventPromises = [];

        for (const [fieldKey, config] of Object.entries(
          this.EntityConfig[entityType].mutual?.mutualFields || {},
        )) {
          publishEventPromises.push(
            this.publishEvent({
              event: EVENT.CORE.ENTITY_MUTUAL_TO_UPDATE,
              payload: {
                byEntityType,
                byEntityId,
                entityType: config.entityType,
                field: fieldKey,
                mutualIds: (parsedMutualPayload as any)[fieldKey],
                publishedAt: entity.updatedAt || new Date().toISOString(),
              },
            }),
          );
        }
        await Promise.allSettled(publishEventPromises);
      }

      await this.publishEvent({
        event: EVENT.CORE.ENTITY_UPSERTED,
        payload: {
          entityType,
          entityId: entity.entityId,
          payload: body,
          createdByAccountId: accountId,
        },
      });

      return c.json(entity);
    } catch (err) {
      if (err instanceof ZodError) {
        c.status(httpStatus.BAD_REQUEST);
        return c.json({
          code: 'API_VALIDATION_ERROR',
          message: 'API validation failed',
          details: err.flatten(),
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

      throw err;
    }
  });
}
