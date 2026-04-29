import type {
  AttributeValue,
  DynamoDB,
  TransactWriteItem,
} from '@aws-sdk/client-dynamodb';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import type {
  AdjustmentCondition,
  EntitySchemaMap,
  Entity as EntityType,
  UpdateCondition,
  createEntityConfig,
} from '@monorise/base';
import { ulid } from 'ulid';
import { z } from 'zod';
import { Entity, type EntityRepository } from '../data/Entity';
import type { EventUtils } from '../data/EventUtils';
import { StandardError, StandardErrorCode } from '../errors/standard-error';
import type { publishEvent as publishEventType } from '../helpers/event';
import type { EventDetail } from '../types/event';
import { EVENT } from '../types/event';
import type {
  TransactionAdjustEntity,
  TransactionCreateEntity,
  TransactionDeleteEntity,
  TransactionOperation,
  TransactionResult,
  TransactionResultEntry,
  TransactionUpdateEntity,
} from '@monorise/base';
import type { EntityServiceLifeCycle } from './entity-service-lifecycle';
import {
  resolveAdjustmentCondition,
  resolveUpdateCondition,
} from './resolve-condition';

const MAX_TRANSACTION_ITEMS = 100;

type PendingEvent = {
  event: EventDetail;
  payload: Record<string, unknown>;
};

export class TransactionService {
  constructor(
    private EntityConfig: Record<
      EntityType,
      ReturnType<typeof createEntityConfig>
    >,
    private EmailAuthEnabledEntities: EntityType[],
    private entityRepository: EntityRepository,
    private dynamodbClient: DynamoDB,
    private publishEvent: typeof publishEventType,
    private entityServiceLifeCycle: EntityServiceLifeCycle,
    private eventUtils: EventUtils,
  ) {}

  executeTransaction = async (
    operations: TransactionOperation[],
    accountId?: string,
  ): Promise<TransactionResult> => {
    if (!operations || operations.length === 0) {
      throw new StandardError(
        StandardErrorCode.TRANSACTION_EMPTY,
        'Transaction must contain at least one operation',
      );
    }

    const allTransactItems: TransactWriteItem[] = [];
    const pendingEvents: PendingEvent[] = [];
    const resultEntries: TransactionResultEntry[] = [];

    // Phase 1: Validate and build TransactWriteItems for each operation
    for (const op of operations) {
      switch (op.operation) {
        case 'createEntity': {
          const { items, entity } = await this.buildCreateItems(op);
          allTransactItems.push(...items);
          pendingEvents.push(
            ...this.collectCreateEvents(
              entity,
              op.payload,
              accountId,
            ),
          );
          resultEntries.push({
            operation: 'createEntity',
            entityType: op.entityType,
            entityId: entity.entityId as string,
            data: entity.data as Record<string, unknown>,
          });
          break;
        }
        case 'updateEntity': {
          const { item, updatedAt } = await this.buildUpdateItem(op);
          allTransactItems.push(item);
          pendingEvents.push(
            ...this.collectUpdateEvents(
              op,
              updatedAt,
              accountId,
            ),
          );
          resultEntries.push({
            operation: 'updateEntity',
            entityType: op.entityType,
            entityId: op.entityId,
          });
          break;
        }
        case 'adjustEntity': {
          const { item, updatedAt } = await this.buildAdjustItem(op);
          allTransactItems.push(item);
          pendingEvents.push({
            event: EVENT.CORE.ENTITY_UPDATED,
            payload: {
              entityType: op.entityType,
              entityId: op.entityId,
              updatedByAccountId: accountId,
              publishedAt: updatedAt,
            },
          });
          resultEntries.push({
            operation: 'adjustEntity',
            entityType: op.entityType,
            entityId: op.entityId,
          });
          break;
        }
        case 'deleteEntity': {
          const item = this.buildDeleteItem(op);
          allTransactItems.push(item);
          pendingEvents.push({
            event: EVENT.CORE.ENTITY_DELETED,
            payload: {
              entityType: op.entityType,
              entityId: op.entityId,
              deletedByAccountId: accountId,
            },
          });
          resultEntries.push({
            operation: 'deleteEntity',
            entityType: op.entityType,
            entityId: op.entityId,
          });
          break;
        }
        default:
          throw new StandardError(
            StandardErrorCode.INVALID_ENTITY_TYPE,
            `Unknown operation: '${(op as TransactionOperation).operation}'`,
          );
      }
    }

    // Phase 2: Validate item count
    if (allTransactItems.length > MAX_TRANSACTION_ITEMS) {
      throw new StandardError(
        StandardErrorCode.TRANSACTION_ITEM_LIMIT_EXCEEDED,
        `Transaction contains ${allTransactItems.length} items, exceeds limit of ${MAX_TRANSACTION_ITEMS}`,
      );
    }

    // Phase 3: Execute transaction
    try {
      await this.dynamodbClient.transactWriteItems({
        TransactItems: allTransactItems,
      });
    } catch (err) {
      if (err instanceof TransactionCanceledException) {
        throw new StandardError(
          StandardErrorCode.TRANSACTION_FAILED,
          'Transaction failed',
          err,
          {
            reasons: err.CancellationReasons?.map((r, i) => ({
              index: i,
              code: r.Code,
              message: r.Message,
            })),
          },
        );
      }
      throw err;
    }

    // Phase 4: Post-commit reads for update/adjust results
    const readPromises = resultEntries.map(async (entry) => {
      if (
        (entry.operation === 'updateEntity' ||
          entry.operation === 'adjustEntity') &&
        !entry.data
      ) {
        try {
          const entity = await this.entityRepository.getEntity(
            entry.entityType,
            entry.entityId,
          );
          entry.data = entity.data as Record<string, unknown>;
        } catch {
          // Entity read failed — return without data
        }
      }
    });
    await Promise.all(readPromises);

    // Phase 5: Publish events (fire-and-forget, same pattern as existing operations)
    await Promise.allSettled(pendingEvents.map((ev) => this.publishEvent(ev)));

    return { results: resultEntries };
  };

  private async buildCreateItems(
    op: TransactionCreateEntity,
  ): Promise<{ items: TransactWriteItem[]; entity: Entity<EntityType> }> {
    const config = this.EntityConfig[op.entityType];
    if (!config) {
      throw new StandardError(
        StandardErrorCode.INVALID_ENTITY_TYPE,
        `Unknown entity type: '${op.entityType}'`,
      );
    }

    const entitySchema = config.createSchema || config.baseSchema;
    if (!entitySchema) {
      throw new StandardError(
        StandardErrorCode.INVALID_ENTITY_TYPE,
        `No schema defined for entity type: '${op.entityType}'`,
      );
    }

    // Validate with finalSchema first (includes mutual schema if defined)
    if (config.finalSchema) {
      config.finalSchema.parse(op.payload);
    }
    const parsedPayload = entitySchema.parse(
      op.payload,
    ) as EntitySchemaMap[EntityType];

    const currentDatetime = new Date();
    const entity = new Entity(
      op.entityType,
      op.entityId || ulid(),
      parsedPayload,
      currentDatetime,
      currentDatetime,
    );

    // Extract unique field values
    const uniqueFields = (config.uniqueFields || []) as string[];
    const uniqueFieldValues: Record<string, string> = {};
    for (const field of uniqueFields) {
      if (!(field in parsedPayload)) continue;
      const value = (parsedPayload as Record<string, unknown>)[field];
      if (typeof value !== 'string') {
        throw new StandardError(
          StandardErrorCode.INVALID_UNIQUE_VALUE_TYPE,
          `Invalid type. ${field} is not a 'string'.`,
        );
      }
      uniqueFieldValues[field] = value;
    }

    const items = this.entityRepository.createEntityTransactItems(entity, {
      uniqueFieldValues,
    });

    return { items, entity };
  }

  private async buildUpdateItem(
    op: TransactionUpdateEntity,
  ): Promise<{ item: TransactWriteItem; updatedAt: string }> {
    const config = this.EntityConfig[op.entityType];
    if (!config) {
      throw new StandardError(
        StandardErrorCode.INVALID_ENTITY_TYPE,
        `Unknown entity type: '${op.entityType}'`,
      );
    }

    // Reject unique field changes in transactions
    const uniqueFields = (config.uniqueFields || []) as string[];
    for (const field of uniqueFields) {
      if (field in op.payload) {
        throw new StandardError(
          StandardErrorCode.TRANSACTION_UNIQUE_FIELD_UPDATE,
          `Cannot update unique field '${field}' within a transaction. Use a standalone updateEntity call instead.`,
        );
      }
    }

    const entitySchema = config.baseSchema;
    if (!entitySchema) {
      throw new StandardError(
        StandardErrorCode.INVALID_ENTITY_TYPE,
        `No schema defined for entity type: '${op.entityType}'`,
      );
    }

    const parsedPayload = entitySchema.partial().parse(op.payload) as Partial<
      EntitySchemaMap[EntityType]
    >;

    const currentDatetime = new Date().toISOString();
    const toUpdateExpressions = this.entityRepository.toUpdate({
      updatedAt: currentDatetime,
      data: parsedPayload,
    });

    // Resolve condition if provided
    let conditionOpts:
      | {
          ConditionExpression: string;
          ExpressionAttributeNames: Record<string, string>;
          ExpressionAttributeValues: Record<string, AttributeValue>;
        }
      | undefined;

    if (op.condition) {
      const updateConditions = config.updateConditions as
        | Record<string, UpdateCondition>
        | undefined;
      if (!updateConditions) {
        throw new StandardError(
          StandardErrorCode.INVALID_CONDITION,
          `Entity '${op.entityType}' has no updateConditions defined`,
        );
      }
      conditionOpts = await resolveUpdateCondition({
        conditionName: op.condition,
        conditions: updateConditions,
        getEntityData: async () => {
          const entity = await this.entityRepository.getEntity(
            op.entityType,
            op.entityId,
          );
          return entity?.data ?? {};
        },
      });
    }

    const entity = new Entity(op.entityType, op.entityId);
    const item: TransactWriteItem = {
      Update: {
        TableName: this.entityRepository.TABLE_NAME,
        Key: entity.keys(),
        ConditionExpression:
          conditionOpts?.ConditionExpression || 'attribute_exists(PK)',
        UpdateExpression: toUpdateExpressions.UpdateExpression,
        ExpressionAttributeNames: {
          ...toUpdateExpressions.ExpressionAttributeNames,
          ...conditionOpts?.ExpressionAttributeNames,
        },
        ExpressionAttributeValues: {
          ...toUpdateExpressions.ExpressionAttributeValues,
          ...conditionOpts?.ExpressionAttributeValues,
        },
      },
    };

    return { item, updatedAt: currentDatetime };
  }

  private async buildAdjustItem(
    op: TransactionAdjustEntity,
  ): Promise<{ item: TransactWriteItem; updatedAt: string }> {
    const config = this.EntityConfig[op.entityType];
    if (!config) {
      throw new StandardError(
        StandardErrorCode.INVALID_ENTITY_TYPE,
        `Unknown entity type: '${op.entityType}'`,
      );
    }

    // Validate all adjustment values are finite numbers
    for (const [key, value] of Object.entries(op.adjustments)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new StandardError(
          StandardErrorCode.INVALID_ENTITY_TYPE,
          `Adjustment field "${key}" must be a finite number`,
        );
      }
    }

    const {
      UpdateExpression,
      ExpressionAttributeNames,
      ExpressionAttributeValues,
    } = this.entityRepository.toAdjustUpdate(op.adjustments);

    const currentDatetime = new Date().toISOString();
    ExpressionAttributeNames['#updatedAt'] = 'updatedAt';
    ExpressionAttributeValues[':updatedAt'] = { S: currentDatetime };
    const fullUpdateExpression = `${UpdateExpression}, #updatedAt = :updatedAt`;

    // Resolve condition if provided
    let conditionOpts:
      | {
          ConditionExpression: string;
          ExpressionAttributeNames: Record<string, string>;
          ExpressionAttributeValues: Record<string, AttributeValue>;
        }
      | undefined;

    const adjustmentConditions = config.adjustmentConditions as
      | Record<string, AdjustmentCondition>
      | undefined;

    if (adjustmentConditions) {
      if (!op.condition) {
        throw new StandardError(
          StandardErrorCode.INVALID_CONDITION,
          `Entity '${op.entityType}' has adjustmentConditions defined; condition is required`,
        );
      }
      conditionOpts = await resolveAdjustmentCondition({
        conditionName: op.condition,
        conditions: adjustmentConditions,
        adjustments: op.adjustments,
        getEntityData: async () => {
          const entity = await this.entityRepository.getEntity(
            op.entityType,
            op.entityId,
          );
          return entity?.data ?? {};
        },
      });
    }

    const entity = new Entity(op.entityType, op.entityId);
    const item: TransactWriteItem = {
      Update: {
        TableName: this.entityRepository.TABLE_NAME,
        Key: entity.keys(),
        UpdateExpression: fullUpdateExpression,
        ConditionExpression:
          conditionOpts?.ConditionExpression || 'attribute_exists(PK)',
        ExpressionAttributeNames: {
          ...ExpressionAttributeNames,
          ...conditionOpts?.ExpressionAttributeNames,
        },
        ExpressionAttributeValues: {
          ...ExpressionAttributeValues,
          ...conditionOpts?.ExpressionAttributeValues,
        },
      },
    };

    return { item, updatedAt: currentDatetime };
  }

  private buildDeleteItem(op: TransactionDeleteEntity): TransactWriteItem {
    const config = this.EntityConfig[op.entityType];
    if (!config) {
      throw new StandardError(
        StandardErrorCode.INVALID_ENTITY_TYPE,
        `Unknown entity type: '${op.entityType}'`,
      );
    }

    const entity = new Entity(op.entityType, op.entityId);
    return {
      Delete: {
        TableName: this.entityRepository.TABLE_NAME,
        Key: entity.keys(),
        ConditionExpression: 'attribute_exists(PK)',
      },
    };
  }

  private collectCreateEvents(
    entity: Entity<EntityType>,
    payload: Record<string, unknown>,
    accountId?: string,
  ): PendingEvent[] {
    const events: PendingEvent[] = [];
    const publishedAt = entity.updatedAt || new Date().toISOString();

    // Mutual events
    const config = this.EntityConfig[entity.entityType];
    const mutualSchema = config?.mutual?.mutualSchema;
    if (mutualSchema) {
      const parsedMutualPayload = mutualSchema.parse(payload);
      if (parsedMutualPayload) {
        for (const [fieldKey, fieldConfig] of Object.entries(
          config.mutual?.mutualFields || {},
        )) {
          const toMutualIds = (fieldConfig as any).toMutualIds;
          const mutualPayload = (parsedMutualPayload as Record<string, any>)[
            fieldKey
          ];
          if (!mutualPayload) continue;

          events.push({
            event: EVENT.CORE.ENTITY_MUTUAL_TO_CREATE,
            payload: {
              byEntityType: entity.entityType,
              byEntityId: entity.entityId,
              entityType: (fieldConfig as any).entityType,
              field: fieldKey,
              mutualIds: toMutualIds
                ? toMutualIds(mutualPayload)
                : mutualPayload,
              customContext: toMutualIds ? mutualPayload : {},
              publishedAt,
            },
          });
        }
      }
    }

    // Entity created event
    events.push({
      event: EVENT.CORE.ENTITY_CREATED,
      payload: {
        entityType: entity.entityType,
        entityId: entity.entityId,
        data: entity.data,
        createdByAccountId: accountId,
        publishedAt,
      },
    });

    return events;
  }

  private collectUpdateEvents(
    op: TransactionUpdateEntity,
    updatedAt: string,
    accountId?: string,
  ): PendingEvent[] {
    const events: PendingEvent[] = [];

    // Mutual update events
    const config = this.EntityConfig[op.entityType];
    const mutualSchema = config?.mutual?.mutualSchema;
    if (mutualSchema) {
      const parsedMutualPayload = mutualSchema.parse(op.payload);
      if (parsedMutualPayload) {
        for (const [fieldKey, fieldConfig] of Object.entries(
          config.mutual?.mutualFields || {},
        )) {
          const toMutualIds = (fieldConfig as any).toMutualIds;
          const mutualPayload = (parsedMutualPayload as Record<string, any>)[
            fieldKey
          ];
          if (!mutualPayload) continue;

          events.push({
            event: EVENT.CORE.ENTITY_MUTUAL_TO_UPDATE,
            payload: {
              byEntityType: op.entityType,
              byEntityId: op.entityId,
              entityType: (fieldConfig as any).entityType,
              field: fieldKey,
              mutualIds: toMutualIds
                ? toMutualIds(mutualPayload)
                : mutualPayload,
              customContext: toMutualIds ? mutualPayload : {},
              publishedAt: updatedAt,
            },
          });
        }
      }
    }

    // Entity updated event
    events.push({
      event: EVENT.CORE.ENTITY_UPDATED,
      payload: {
        entityType: op.entityType,
        entityId: op.entityId,
        updatedByAccountId: accountId,
        publishedAt: updatedAt,
      },
    });

    return events;
  }
}
