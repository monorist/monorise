import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type {
  EntitySchemaMap,
  Entity as EntityType,
  createEntityConfig,
} from '@monorise/base';
import { ulid } from 'ulid';
import { z } from 'zod';
import type { DbUtils } from '../data/DbUtils';
import { Entity, type EntityRepository } from '../data/Entity';
import { Mutual, type MutualRepository } from '../data/Mutual';
import type { publishEvent as publishEventType } from '../helpers/event';
import { EVENT } from '../types/event';
import type { EntityServiceLifeCycle } from './entity-service-lifecycle';

export class MutualService {
  constructor(
    private EntityConfig: Record<
      EntityType,
      ReturnType<typeof createEntityConfig>
    >,
    private entityRepository: EntityRepository,
    private mutualRepository: MutualRepository,
    private publishEvent: typeof publishEventType,
    private ddbUtils: DbUtils,
    private entityServiceLifeCycle: EntityServiceLifeCycle,
  ) {}

  private getMutualDataSchema(
    byEntityType: EntityType,
    entityType: EntityType,
  ) {
    // Check byEntityType → entityType direction first, then reverse
    for (const [from, to] of [
      [byEntityType, entityType],
      [entityType, byEntityType],
    ]) {
      const mutualFields = this.EntityConfig[from]?.mutual?.mutualFields;
      if (!mutualFields) continue;

      for (const config of Object.values(mutualFields)) {
        if (config.entityType === to && config.mutual?.mutualDataSchema) {
          return config.mutual.mutualDataSchema;
        }
      }
    }
    return undefined;
  }

  createMutual = async <
    B extends EntityType,
    T extends EntityType,
    A extends EntityType,
  >({
    byEntityType,
    byEntityId,
    entityType,
    entityId,
    mutualPayload,
    accountId,
    options = {},
  }: {
    byEntityType: B;
    byEntityId: string;
    entityType: T;
    entityId: string;
    mutualPayload?: Record<string, unknown>;
    accountId?: string | string[];
    options?: {
      asEntity?: A;
      // when this is enabled, creation of entity will be synchrounous,
      // use this when your business flow requires entity to be created first.
      // Else, we can leave this false and let the creation of entity being async and eventually consistent.
      // Costing will be lower when things happened async as we do not require transactional write.
      ensureEntityStrongConsistentWrite?: boolean;
      mutualId?: string;
      // only use for migration purpose, for example when mutual is already created,
      // but when you need this mutual to be created as entity, mutual creation can be skipped
      skipMutualCreation?: boolean;
      createAndUpdateDatetime?: Date;
      ConditionExpression?: string;
      ExpressionAttributeNames?: Record<string, string>;
      ExpressionAttributeValues?: Record<string, AttributeValue>;
    };
  }) => {
    const {
      ensureEntityStrongConsistentWrite = false,
      asEntity,
      createAndUpdateDatetime,
      mutualId,
      skipMutualCreation = false,
      ConditionExpression,
      ExpressionAttributeNames,
      ExpressionAttributeValues,
    } = options;

    const errorContext: Record<string, unknown> = {
      arguments: {
        byEntityType,
        byEntityId,
        entityType,
        entityId,
        mutualPayload,
        options,
      },
    };

    console.log('[MONORISE_DEBUG] createMutual service start:', {
      byEntityType,
      byEntityId,
      entityType,
      entityId,
      mutualPayload,
      options,
    });

    const schema =
      this.getMutualDataSchema(byEntityType, entityType) ??
      z.record(z.string(), z.any());
    console.log('[MONORISE_DEBUG] createMutual schema resolved');
    
    const parsedMutualPayload = schema.parse(mutualPayload);
    console.log('[MONORISE_DEBUG] createMutual payload parsed:', parsedMutualPayload);

    console.log('[MONORISE_DEBUG] createMutual fetching entities...');
    const [{ data: byEntityData }, { data: entityData }] = await Promise.all([
      this.entityRepository.getEntity(byEntityType, byEntityId),
      this.entityRepository.getEntity(entityType, entityId),
    ]);
    console.log('[MONORISE_DEBUG] createMutual entities fetched:', {
      hasByEntityData: !!byEntityData,
      hasEntityData: !!entityData,
    });
    errorContext.byEntityData = byEntityData;
    errorContext.entityData = entityData;

    console.log('[MONORISE_DEBUG] createMutual checking mutual exist...');
    await this.mutualRepository.checkMutualExist(
      byEntityType,
      byEntityId,
      entityType,
      entityId,
    );
    console.log('[MONORISE_DEBUG] createMutual mutual does not exist (ok)');

    const currentDatetime = createAndUpdateDatetime || new Date();

    const mutual = new Mutual(
      byEntityType,
      byEntityId,
      byEntityData,
      entityType,
      entityId,
      entityData,
      parsedMutualPayload,
      mutualId || ulid(),
      currentDatetime,
      currentDatetime,
      currentDatetime,
    );
    console.log('[MONORISE_DEBUG] createMutual mutual object created:', {
      mutualId: mutual.mutualId,
    });

    const mutualTransactions = skipMutualCreation
      ? []
      : this.mutualRepository.createMutualTransactItems(mutual, {
          ConditionExpression,
          ExpressionAttributeNames,
          ExpressionAttributeValues,
        });

    const entityTransactions = [];
    let entity: Entity<A> | undefined;

    // construct entity transact item only if need to ensure strong consistent write
    if (asEntity && ensureEntityStrongConsistentWrite) {
      entity = new Entity(
        asEntity,
        mutual.mutualId,
        parsedMutualPayload as EntitySchemaMap[A],
        currentDatetime,
        currentDatetime,
      );

      entityTransactions.push(
        ...this.entityRepository.createEntityTransactItems(entity, {
          mutualId: mutual.mainPk,
        }),
      );
    }

    // write to db regardless of options
    const createTransactItems = [...mutualTransactions, ...entityTransactions];
    errorContext.createTransactItems = createTransactItems;

    console.log('[MONORISE_DEBUG] createMutual executing transaction:', {
      transactItemCount: createTransactItems.length,
    });
    await this.ddbUtils.executeTransactWrite({
      TransactItems: createTransactItems,
    });
    console.log('[MONORISE_DEBUG] createMutual transaction succeeded');

    // duplicated behaviour from entityService.createEntity after write success
    if (asEntity && entity && ensureEntityStrongConsistentWrite) {
      await this.entityServiceLifeCycle.afterCreateEntityHook(
        entity,
        mutualPayload,
        accountId,
      );
    }

    // publish an event to create entity if asEntity defined
    // since it's event-driven, it would be the creation of entity
    // would be eventual consistent
    if (options.asEntity && !ensureEntityStrongConsistentWrite) {
      await this.publishEvent({
        event: EVENT.CORE.CREATE_ENTITY,
        payload: {
          entityType: options.asEntity,
          entityId: mutual.mutualId,
          entityPayload: mutual.mutualData,
          accountId,
          options: {
            createAndUpdateDatetime: mutual.createdAt,
            mutualId: mutual.mutualId,
          },
        },
      });
    }

    const eventPayload = {
      byEntityType,
      byEntityId,
      entityType,
      entityId,
      parsedMutualPayload,
      accountId,
      publishedAt: new Date().toISOString(),
    };

    const eventPromises = [
      this.publishEvent({
        event: EVENT.CORE.MUTUAL_CREATED(byEntityType, entityType),
        payload: eventPayload,
      }),
    ];

    await Promise.all(eventPromises);
    console.log('[MONORISE_DEBUG] createMutual service complete');

    return { mutual, eventPayload };
  };

  updateMutual = async <
    B extends EntityType,
    T extends EntityType,
    M extends Record<string, unknown>,
  >({
    byEntityType,
    byEntityId,
    entityType,
    entityId,
    mutualPayload,
    accountId,
    options,
  }: {
    byEntityType: B;
    byEntityId: string;
    entityType: T;
    entityId: string;
    mutualPayload: M;
    accountId?: string | string[];
    options?: {
      maxObjectUpdateLevel?: number;
      returnUpdatedValue?: boolean;
    };
  }) => {
    console.log('[MONORISE_DEBUG] updateMutual service start:', {
      byEntityType,
      byEntityId,
      entityType,
      entityId,
      mutualPayload,
      options,
    });

    const schema =
      this.getMutualDataSchema(byEntityType, entityType) ??
      z.record(z.string(), z.any());
    console.log('[MONORISE_DEBUG] updateMutual schema resolved');
    
    const parsedMutualPayload = schema.parse(mutualPayload);
    console.log('[MONORISE_DEBUG] updateMutual payload parsed:', parsedMutualPayload);

    console.log('[MONORISE_DEBUG] updateMutual calling repository...');
    const mutual = await this.mutualRepository.updateMutual(
      byEntityType,
      byEntityId,
      entityType,
      entityId,
      { mutualData: parsedMutualPayload },
      options,
    );
    console.log('[MONORISE_DEBUG] updateMutual repository result:', {
      hasMutual: !!mutual,
      mutualId: mutual?.mutualId,
    });

    await this.publishEvent({
      event: EVENT.CORE.MUTUAL_UPDATED(byEntityType, entityType),
      payload: {
        byEntityType,
        byEntityId,
        entityType,
        entityId,
        parsedMutualPayload,
        updatedByAccountId: accountId,
      },
    });
    console.log('[MONORISE_DEBUG] updateMutual service complete');

    return mutual;
  };

  deleteMutual = async ({
    byEntityType,
    byEntityId,
    entityType,
    entityId,
    accountId,
  }: {
    byEntityType: EntityType;
    byEntityId: string;
    entityType: EntityType;
    entityId: string;
    accountId?: string | string[];
  }) => {
    const mutual = await this.mutualRepository.deleteMutual(
      byEntityType,
      byEntityId,
      entityType,
      entityId,
    );

    await this.publishEvent({
      event: EVENT.CORE.MUTUAL_UPDATED(byEntityType, entityType),
      payload: {
        byEntityType,
        byEntityId,
        entityType,
        entityId,
        deletedByAccountId: accountId,
      },
    });

    return mutual;
  };
}
