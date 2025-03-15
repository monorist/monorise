import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type { EntitySchemaMap, Entity as EntityType } from '@monorise/base';
import { ulid } from 'ulid';
import { z } from 'zod';
import type { DbUtils } from '../data/DbUtils';
import { Entity, type EntityRepository } from '../data/Entity';
import type { EventUtils } from '../data/EventUtils';
import { Mutual, type MutualRepository } from '../data/Mutual';
import type { publishEvent as publishEventType } from '../helpers/event';
import { EVENT } from '../types/event';
import { afterCreateEntityHook } from './entity-service-lifecycle';

export class MutualService {
  constructor(
    private entityRepository: EntityRepository,
    private mutualRepository: MutualRepository,
    private publishEvent: typeof publishEventType,
    private eventUtils: EventUtils,
    private ddbUtils: DbUtils,
  ) {}

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

    // TODO: schema validation for mutual data by config
    const schema = z.record(z.string(), z.any());
    const parsedMutualPayload = schema.parse(mutualPayload);

    const [{ data: byEntityData }, { data: entityData }] = await Promise.all([
      this.entityRepository.getEntity(byEntityType, byEntityId),
      this.entityRepository.getEntity(entityType, entityId),
    ]);
    errorContext.byEntityData = byEntityData;
    errorContext.entityData = entityData;

    await this.mutualRepository.checkMutualExist(
      byEntityType,
      byEntityId,
      entityType,
      entityId,
    );

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

    await this.ddbUtils.executeTransactWrite({
      TransactItems: createTransactItems,
    });

    // duplicated behaviour from entityService.createEntity after write success
    if (asEntity && entity && ensureEntityStrongConsistentWrite) {
      await afterCreateEntityHook({
        entity,
        entityPayload: mutualPayload,
        accountId,
        publishEvent: this.publishEvent,
        eventUtils: this.eventUtils,
      });
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
        event: EVENT.CORE.MUTUAL_CREATED,
        payload: eventPayload,
      }),
    ];

    await Promise.all(eventPromises);

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
    const schema = z.record(z.string(), z.any());
    const parsedMutualPayload = schema.parse(mutualPayload);
    const mutual = await this.mutualRepository.updateMutual(
      byEntityType,
      byEntityId,
      entityType,
      entityId,
      { mutualData: parsedMutualPayload },
      options,
    );

    await this.publishEvent({
      event: EVENT.CORE.MUTUAL_UPDATED,
      payload: {
        byEntityType,
        byEntityId,
        entityType,
        entityId,
        parsedMutualPayload,
        updatedByAccountId: accountId,
      },
    });

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
      event: EVENT.CORE.MUTUAL_UPDATED,
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
