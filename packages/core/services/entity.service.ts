import type {
  EntitySchemaMap,
  Entity as EntityType,
  createEntityConfig,
} from '@monorise/base';
import { z } from 'zod';
import type { EntityRepository } from '../data/Entity';
import {
  buildConditionExpression,
  type WhereConditions,
} from '../data/utils/build-condition-expression';
import { StandardError, StandardErrorCode } from '../errors/standard-error';
import type { publishEvent as publishEventType } from '../helpers/event';
import type { EventDetailBody as MutualProcessorEventDetailBody } from '../processors/mutual-processor';
import { EVENT } from '../types/event';
import type { EntityServiceLifeCycle } from './entity-service-lifecycle';

export class EntityService {
  constructor(
    private EntityConfig: Record<
      EntityType,
      ReturnType<typeof createEntityConfig>
    >,
    private EmailAuthEnabledEntities: EntityType[],
    private entityRepository: EntityRepository,
    private publishEvent: typeof publishEventType,
    private entityServiceLifeCycle: EntityServiceLifeCycle,
  ) {}

  createEntity = async <T extends EntityType>({
    entityType,
    entityId,
    entityPayload,
    accountId,
    options,
  }: {
    entityType: T;
    entityPayload: EntitySchemaMap[T] | Record<string, any>;
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
      throw new StandardError(
        StandardErrorCode.INVALID_ENTITY_TYPE,
        'Invalid entity type',
      );
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

    await this.entityServiceLifeCycle.afterCreateEntityHook(
      entity,
      entityPayload,
      accountId,
    );

    return entity;
  };

  adjustEntity = async <T extends EntityType>({
    entityType,
    entityId,
    adjustments,
    accountId,
  }: {
    entityType: T;
    entityId: string;
    adjustments: Record<string, number>;
    accountId?: string;
  }) => {
    const rawConstraints = this.EntityConfig[entityType]?.adjustmentConstraints;

    // Resolve dynamic minField/maxField to static values
    let resolvedConstraints = rawConstraints;
    if (rawConstraints) {
      const hasDynamicFields = Object.values(rawConstraints).some(
        (c: any) => c.minField || c.maxField,
      );
      if (hasDynamicFields) {
        const currentEntity = await this.entityRepository.getEntity(entityType, entityId);
        const data = currentEntity?.data ?? {};
        resolvedConstraints = {};
        for (const [field, constraint] of Object.entries(rawConstraints)) {
          const resolved: { min?: number; max?: number } = {};
          if ((constraint as any).min !== undefined) resolved.min = (constraint as any).min;
          if ((constraint as any).max !== undefined) resolved.max = (constraint as any).max;
          if ((constraint as any).minField) resolved.min = data[(constraint as any).minField] ?? 0;
          if ((constraint as any).maxField) resolved.max = data[(constraint as any).maxField] ?? Number.MAX_SAFE_INTEGER;
          resolvedConstraints[field] = resolved;
        }
      }
    }

    const entity = await this.entityRepository.adjustEntity(
      entityType,
      entityId,
      adjustments,
      resolvedConstraints as any,
    );

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
  };

  updateEntity = async <T extends EntityType>({
    entityType,
    entityId,
    entityPayload,
    accountId,
    where,
  }: {
    entityType: T;
    entityId: string;
    entityPayload: Partial<EntitySchemaMap[T]>;
    accountId?: string | string[];
    where?: WhereConditions;
  }) => {
    const errorContext: Record<string, unknown> = {};

    try {
      const entitySchema = this.EntityConfig[entityType].baseSchema;
      const mutualSchema = this.EntityConfig[entityType].mutual?.mutualSchema;

      if (!entitySchema) {
        throw new StandardError(
          StandardErrorCode.INVALID_ENTITY_TYPE,
          'Invalid entity type',
        );
      }

      const parsedEntityPayload = entitySchema.parse(entityPayload) as Partial<
        EntitySchemaMap[T]
      >;
      const parsedMutualPayload = mutualSchema?.parse(entityPayload);
      errorContext.parsedMutualPayload = parsedMutualPayload;

      const opts =
        where && Object.keys(where).length > 0
          ? buildConditionExpression(where)
          : undefined;

      const entity = await this.entityRepository.updateEntity(
        entityType,
        entityId,
        { data: parsedEntityPayload },
        opts,
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

  deleteEntity = async <T extends EntityType>({
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
