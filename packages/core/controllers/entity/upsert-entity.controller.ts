import type { Entity, createEntityConfig } from '@monorise/base';
import type { Request, Response } from 'express';
import httpStatus from 'http-status';
import { ZodError } from 'zod';
import type { EntityRepository } from '../../data/Entity';
import { StandardError } from '../../errors/standard-error';
import type { publishEvent as publishEventType } from '../../helpers/event';
import { EVENT } from '../../types/event';

export class UpsertEntityController {
  constructor(
    private EntityConfig: Record<Entity, ReturnType<typeof createEntityConfig>>,
    private entityRepository: EntityRepository,
    private publishEvent: typeof publishEventType,
  ) {}

  controller: (req: Request, res: Response) => void = async (req, res) => {
    const accountId = req.headers['account-id'];
    const { entityType, entityId } = req.params as unknown as {
      entityType: Entity;
      entityId: string;
    };

    try {
      const entitySchema =
        this.EntityConfig[entityType].createSchema ||
        this.EntityConfig[entityType].baseSchema;
      const mutualSchema = this.EntityConfig[entityType].mutual?.mutualSchema;

      if (!entitySchema || !mutualSchema) {
        throw new StandardError('Invalid entity type', 'INVALID_ENTITY_TYPE');
      }

      const parsedEntityPayload = entitySchema.parse(req.body);
      const parsedMutualPayload = mutualSchema.parse(req.body);

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
          payload: req.body,
          createdByAccountId: accountId,
        },
      });

      return res.status(httpStatus.OK).json(entity);
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(httpStatus.BAD_REQUEST).json({
          code: 'API_VALIDATION_ERROR',
          message: 'API validation failed',
          details: err.flatten(),
        });
      }

      if (err instanceof StandardError && err.code === 'EMAIL_EXISTS') {
        return res.status(httpStatus.BAD_REQUEST).json({
          ...err.toJSON(),
        });
      }

      throw err;
    }
  };
}
