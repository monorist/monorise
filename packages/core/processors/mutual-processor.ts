import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import type { Entity } from '@monorise/base';
import type { SQSBatchItemFailure, SQSEvent } from 'aws-lambda';
// import { EntityConfig } from '#/lambda-layer/monorise';
import { Mutual } from '../data/Mutual';
import { StandardError } from '../errors/standard-error';
import { parseSQSBusEvent } from '../helpers/event';
import type { DependencyContainer } from '../services/DependencyContainer';
import { EVENT } from '../types/event';

export type EventDetailBody = {
  mutualIds: string[];
  byEntityType: Entity;
  byEntityId: string;
  entityType: Entity;
  field: string;
  publishedAt: string;
  customContext?: Record<string, unknown>;
};

// const container = new DependencyContainer();

const processEntities = async (
  entityIds: string[],
  action: (id: string) => Promise<void>,
) => Promise.allSettled(entityIds.map(action));

export const handler =
  (container: DependencyContainer) => async (ev: SQSEvent) => {
    const batchItemFailures: SQSBatchItemFailure[] = [];
    const { entityRepository, mutualRepository, publishEvent } = container;

    await Promise.allSettled(
      ev.Records.map(async (record) => {
        const errorContext: Record<string, unknown> = {};
        const body = parseSQSBusEvent<EventDetailBody>(record.body);
        const { detail } = body;
        const {
          mutualIds,
          byEntityType,
          byEntityId,
          entityType,
          field,
          publishedAt,
          customContext,
        } = detail;
        errorContext.body = body;

        try {
          // Validate if mutual configuration exists
          const config =
            container.config.EntityConfig[byEntityType]?.mutual?.mutualFields?.[
              field
            ];

          if (!config) {
            throw new StandardError('INVALID_MUTUAL', 'Invalid mutual');
          }

          const mutualDataProcessor =
            config.mutualDataProcessor ?? (() => ({}));

          // Create a lock to prevent concurrent modifications
          await mutualRepository.createMutualLock({
            byEntityType,
            byEntityId,
            entityType,
            version: publishedAt,
          });

          // Fetch related entities in parallel
          const [byEntity, mutuals] = await Promise.all([
            entityRepository.getEntity(byEntityType, byEntityId),
            mutualRepository.listEntitiesByEntity(
              byEntityType,
              byEntityId,
              entityType,
            ),
          ]);

          // Determine which entities were added, removed, or need updates
          const existingEntityIds = new Set(
            mutuals.items.map((m) => m.entityId),
          );
          const newMutualIds = new Set(mutualIds ?? []);

          const addedEntityIds = [...newMutualIds].filter(
            (id) => !existingEntityIds.has(id),
          );
          const deletedEntityIds = [...existingEntityIds].filter(
            (id) => !newMutualIds.has(id),
          );
          const toUpdateEntityIds = [...existingEntityIds].filter((id) =>
            newMutualIds.has(id),
          );

          errorContext.existingEntityIds = [...existingEntityIds];
          errorContext.addedEntityIds = addedEntityIds;
          errorContext.deletedEntityIds = deletedEntityIds;
          errorContext.toUpdateEntityIds = toUpdateEntityIds;

          const addEntities = await processEntities(
            addedEntityIds,
            async (id) => {
              const entity = await entityRepository.getEntity(entityType, id);
              await mutualRepository.createMutual(
                byEntityType,
                byEntityId,
                byEntity.data,
                entityType,
                id,
                entity.data,
                mutualDataProcessor(
                  mutualIds,
                  new Mutual(
                    byEntityType,
                    byEntityId,
                    byEntity.data,
                    entityType,
                    id,
                    entity.data,
                    {},
                  ),
                  customContext,
                ),
                {
                  ConditionExpression:
                    'attribute_not_exists(#mutualUpdatedAt) OR #mutualUpdatedAt < :publishedAt',
                  ExpressionAttributeNames: {
                    '#mutualUpdatedAt': 'mutualUpdatedAt',
                  },
                  ExpressionAttributeValues: {
                    ':publishedAt': { S: publishedAt },
                  },
                  createAndUpdateDatetime: new Date(publishedAt),
                },
              );
            },
          );

          const deleteEntities = await processEntities(
            deletedEntityIds,
            async (id) => {
              await mutualRepository.deleteMutual(
                byEntityType,
                byEntityId,
                entityType,
                id,
                {
                  ConditionExpression:
                    'attribute_exists(PK) AND #mutualUpdatedAt < :publishedAt',
                  ExpressionAttributeNames: {
                    '#mutualUpdatedAt': 'mutualUpdatedAt',
                  },
                  ExpressionAttributeValues: {
                    ':publishedAt': { S: publishedAt },
                  },
                },
              );
            },
          );

          const updateEntities = await processEntities(
            toUpdateEntityIds,
            async (id) => {
              await mutualRepository.updateMutual(
                byEntityType,
                byEntityId,
                entityType,
                id,
                {
                  mutualData: mutualDataProcessor(
                    mutualIds,
                    new Mutual(
                      byEntityType,
                      byEntityId,
                      byEntity.data,
                      entityType,
                      id,
                      {},
                      {},
                    ),
                    customContext,
                  ),
                  mutualUpdatedAt: publishedAt,
                },
                {
                  ConditionExpression:
                    'attribute_exists(PK) AND #mutualUpdatedAt < :publishedAt',
                  ExpressionAttributeNames: {
                    '#mutualUpdatedAt': 'mutualUpdatedAt',
                  },
                  ExpressionAttributeValues: {
                    ':publishedAt': { S: publishedAt },
                  },
                },
              );
            },
          );

          errorContext.results = {
            addEntities,
            deleteEntities,
            updateEntities,
          };

          // release lock
          await mutualRepository.deleteMutualLock({
            byEntityType,
            byEntityId,
            entityType,
          });

          // Check for unprocessable errors in processing results
          if (
            [...addEntities, ...deleteEntities, ...updateEntities].some(
              (res) =>
                res.status === 'rejected' &&
                !(
                  res.reason instanceof TransactionCanceledException ||
                  (res.reason instanceof StandardError &&
                    res.reason.code === 'MUTUAL_NOT_FOUND')
                ),
            )
          ) {
            throw new StandardError(
              'MUTUAL_PROCESSOR_ERROR',
              'Mutual processor error',
              null,
              errorContext,
            );
          }

          await publishEvent({
            event: EVENT.CORE.ENTITY_MUTUAL_PROCESSED,
            payload: {
              byEntityType,
              byEntityId,
              entityType,
              field,
              mutualIds,
              publishedAt,
            },
          });
        } catch (err) {
          console.error(
            '=====MUTUAL_PROCESSOR_ERROR=====',
            err,
            JSON.stringify({ errorContext }, null, 2),
          );

          // Release the lock to avoid deadlocks
          await mutualRepository.deleteMutualLock({
            byEntityType,
            byEntityId,
            entityType,
          });

          if (
            err instanceof StandardError &&
            ['INVALID_MUTUAL', 'MUTUAL_LOCK_CONFLICT'].includes(err.code)
          ) {
            return;
          }

          batchItemFailures.push({ itemIdentifier: record.messageId });
        }
      }),
    );

    return { batchItemFailures };
  };
