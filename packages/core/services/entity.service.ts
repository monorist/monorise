import type {
  AdjustmentCondition,
  EntitySchemaMap,
  Entity as EntityType,
  UpdateCondition,
  WhereConditions,
  createEntityConfig,
} from '@monorise/base';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { z } from 'zod';
import type { EntityRepository } from '../data/Entity';
import { buildConditionExpression } from '../data/utils/build-condition-expression';
import { StandardError, StandardErrorCode } from '../errors/standard-error';
import type { publishEvent as publishEventType } from '../helpers/event';
import type { EventDetailBody as MutualProcessorEventDetailBody } from '../processors/mutual-processor';
import { EVENT } from '../types/event';
import type { EntityServiceLifeCycle } from './entity-service-lifecycle';
import {
  resolveAdjustmentCondition,
  resolveUpdateCondition,
} from './resolve-condition';

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
    condition,
  }: {
    entityType: T;
    entityId: string;
    adjustments: Record<string, number>;
    accountId?: string;
    condition?: string;
  }) => {
    const entityConfig = this.EntityConfig[entityType];
    const adjustmentConditions = entityConfig?.adjustmentConditions as
      | Record<string, AdjustmentCondition>
      | undefined;
    const rawConstraints = entityConfig?.adjustmentConstraints;

    let opts:
      | {
          ConditionExpression: string;
          ExpressionAttributeNames: Record<string, string>;
          ExpressionAttributeValues: Record<string, AttributeValue>;
        }
      | undefined;

    if (adjustmentConditions) {
      // New conditions system — $condition is required
      if (!condition) {
        throw new StandardError(
          StandardErrorCode.INVALID_CONDITION,
          'Entity has adjustmentConditions defined; $condition is required for adjustEntity',
        );
      }
      opts = await resolveAdjustmentCondition({
        conditionName: condition,
        conditions: adjustmentConditions,
        adjustments,
        getEntityData: async () => {
          const entity = await this.entityRepository.getEntity(entityType, entityId);
          return entity?.data ?? {};
        },
      });
    } else if (rawConstraints) {
      console.warn(
        '[monorise] adjustmentConstraints is deprecated. Use adjustmentConditions instead.',
      );
      // Legacy adjustmentConstraints — backward compatibility
      let resolvedConstraints = rawConstraints;
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
      opts = this.buildLegacyAdjustCondition(adjustments, resolvedConstraints);
    }

    const entity = await this.entityRepository.adjustEntity(
      entityType,
      entityId,
      adjustments,
      opts,
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
    condition,
    where,
  }: {
    entityType: T;
    entityId: string;
    entityPayload: Partial<EntitySchemaMap[T]>;
    accountId?: string | string[];
    condition?: string;
    /** @deprecated Use `condition` (named condition) instead of raw `where`. */
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

      let opts:
        | {
            ConditionExpression: string;
            ExpressionAttributeNames: Record<string, string>;
            ExpressionAttributeValues: Record<string, AttributeValue>;
          }
        | undefined;

      if (condition) {
        const updateConditions = this.EntityConfig[entityType]?.updateConditions as
          | Record<string, UpdateCondition>
          | undefined;
        if (!updateConditions) {
          throw new StandardError(
            StandardErrorCode.INVALID_CONDITION,
            `Entity '${entityType}' has no updateConditions defined`,
          );
        }
        opts = await resolveUpdateCondition({
          conditionName: condition,
          conditions: updateConditions,
          getEntityData: async () => {
            const entity = await this.entityRepository.getEntity(entityType, entityId);
            return entity?.data ?? {};
          },
        });
      } else if (where && Object.keys(where).length > 0) {
        // Legacy $where — backward compatibility
        console.warn(
          '[monorise] $where is deprecated. Use named conditions via $condition instead.',
        );
        opts = buildConditionExpression(where);
      }

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

  /** @deprecated Converts legacy adjustmentConstraints to condition expression opts. */
  private buildLegacyAdjustCondition(
    adjustments: Record<string, number>,
    constraints: Record<string, { min?: number; max?: number }>,
  ) {
    const conditionParts: string[] = [];
    const names: Record<string, string> = { '#data': 'data' };
    const values: Record<string, unknown> = {};

    for (const [field, constraint] of Object.entries(constraints)) {
      const delta = adjustments[field];
      if (delta === undefined) continue;
      const namePlaceholder = `#where_${field}`;
      names[namePlaceholder] = field;
      const fieldRef = `#data.${namePlaceholder}`;

      if (constraint.min !== undefined && delta < 0) {
        const valKey = `:where_${field}_min_threshold`;
        conditionParts.push(`${fieldRef} >= ${valKey}`);
        values[valKey] = constraint.min - delta;
      }
      if (constraint.max !== undefined && delta > 0) {
        const valKey = `:where_${field}_max_threshold`;
        conditionParts.push(`${fieldRef} <= ${valKey}`);
        values[valKey] = constraint.max - delta;
      }
    }

    if (conditionParts.length === 0) return undefined;

    return {
      ConditionExpression: conditionParts.join(' AND '),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: marshall(values) as Record<string, AttributeValue>,
    };
  }

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
