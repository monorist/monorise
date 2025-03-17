import type { Entity, EntitySchemaMap } from '@monorise/base';
import { z } from 'zod';
// import {
//   EmailAuthEnabledEntities,
//   EntityConfig,
// } from '#/lambda-layer/monorise';
import type { EntityRepository } from '../data/Entity';
import type { EventUtils } from '../data/EventUtils';
import { StandardError } from '../errors/standard-error';
import type { publishEvent as publishEventType } from '../helpers/event';
import type { EventDetailBody as MutualProcessorEventDetailBody } from '../processors/mutual-processor';
import { EVENT } from '../types/event';
import { afterCreateEntityHook } from './entity-service-lifecycle';

export class EntityService {
  constructor(
    private EntityConfig: any,
    private EmailAuthEnabledEntities: string[],
    private entityRepository: EntityRepository,
    private publishEvent: typeof publishEventType,
    private eventUtils: EventUtils,
  ) {}

  createEntity = async <T extends Entity>({
    entityType,
    entityId,
    entityPayload,
    accountId,
    options,
  }: {
    entityType: T;
    entityPayload: EntitySchemaMap[T];
    entityId?: string;
    accountId?: string | string[];
    options?: {
      createAndUpdateDatetime?: string;
      mutualId?: string;
    };
  }) => {
    const finalSchema = this.EntityConfig[entityType].finalSchema;
    const entitySchema =
      this.EntityConfig[entityType]?.createSchema ||
      this.EntityConfig[entityType]?.baseSchema ||
      z.object({});
    // const mutualSchema = this.EntityConfig[entityType]?.mutual?.mutualSchema;

    if (!finalSchema || !entitySchema) {
      throw new StandardError('INVALID_ENTITY_TYPE', 'Invalid entity type');
    }

    finalSchema.parse(entityPayload);

    const parsedEntityPayload = entitySchema.parse(
      entityPayload,
    ) as EntitySchemaMap[T] & { email: string };

    // TODO: Create entity to accept mutual payload, so that mutual
    // relationship can be formed when creating entity
    // const parsedMutualPayload = mutualSchema?.parse(entityPayload);

    if (this.EmailAuthEnabledEntities.includes(entityType)) {
      await this.entityRepository.getEmailAvailability(
        entityType,
        parsedEntityPayload.email,
      );
    }

    const entity = await this.entityRepository.createEntity(
      entityType,
      parsedEntityPayload,
      entityId,
      {
        ...(options?.mutualId
          ? {
              mutualId: `MUTUAL#${options.mutualId}`,
            }
          : {}),
        createAndUpdateDatetime: options?.createAndUpdateDatetime
          ? new Date(options.createAndUpdateDatetime)
          : new Date(),
      },
    );

    await afterCreateEntityHook({
      entity,
      entityPayload,
      accountId,
      publishEvent: this.publishEvent,
      eventUtils: this.eventUtils,
    });

    return entity;
  };

  updateEntity = async <T extends Entity>({
    entityType,
    entityId,
    entityPayload,
    accountId,
  }: {
    entityType: T;
    entityId: string;
    entityPayload: Partial<EntitySchemaMap[T]>;
    accountId?: string | string[];
  }) => {
    const errorContext: Record<string, unknown> = {};

    try {
      const entitySchema = this.EntityConfig[entityType].baseSchema;
      const mutualSchema = this.EntityConfig[entityType].mutual?.mutualSchema;

      if (!entitySchema) {
        throw new StandardError('Invalid entity type', 'INVALID_ENTITY_TYPE');
      }

      const parsedEntityPayload = entitySchema.parse(entityPayload) as Partial<
        EntitySchemaMap[T]
      >;
      const parsedMutualPayload = mutualSchema?.parse(entityPayload);
      errorContext.parsedMutualPayload = parsedMutualPayload;

      const entity = await this.entityRepository.updateEntity(
        entityType,
        entityId,
        { data: parsedEntityPayload },
      );
      errorContext.entity = entity;

      if (parsedMutualPayload) {
        const byEntityType = entityType;
        const byEntityId = entityId;
        const publishEventPromises = [];

        for (const [fieldKey, config] of Object.entries(
          this.EntityConfig[entityType].mutual?.mutualFields || {},
        )) {
          const toMutualIds = config.toMutualIds;
          const mutualPayload = (parsedMutualPayload as Record<string, any>)[
            fieldKey
          ];
          if (!mutualPayload) continue;

          publishEventPromises.push(
            this.publishEvent<MutualProcessorEventDetailBody>({
              event: EVENT.CORE.ENTITY_MUTUAL_TO_UPDATE,
              payload: {
                byEntityType,
                byEntityId,
                entityType: config.entityType,
                field: fieldKey,
                mutualIds: toMutualIds
                  ? toMutualIds(mutualPayload)
                  : mutualPayload,
                customContext: toMutualIds ? mutualPayload : {},
                publishedAt: entity.updatedAt || new Date().toISOString(),
              },
            }),
          );
        }
        await Promise.allSettled(publishEventPromises);
      }

      await this.publishEvent({
        event: EVENT.CORE.ENTITY_UPDATED,
        payload: {
          entityType,
          entityId,
          data: entity.data,
          updatedByAccountId: accountId,
          publishedAt: entity.updatedAt || new Date().toISOString(),
        },
      });

      return entity;
    } catch (error) {
      if (error && typeof error === 'object') {
        (error as Record<string, unknown>).context = errorContext;
      }
      throw error;
    }
  };

  deleteEntity = async <T extends Entity>({
    entityType,
    entityId,
    accountId,
  }: {
    entityType: T;
    entityId: string;
    accountId?: string | string[];
  }) => {
    await this.entityRepository.deleteEntity(entityType, entityId);

    await this.publishEvent({
      event: EVENT.CORE.ENTITY_DELETED,
      payload: {
        entityType,
        entityId,
        deletedByAccountId: accountId,
      },
    });
  };
}
