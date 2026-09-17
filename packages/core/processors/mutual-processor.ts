import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import type { Entity } from '@monorise/base';
import type { SQSBatchItemFailure, SQSEvent } from 'aws-lambda';
import { ulid } from 'ulid';
// import { EntityConfig } from '#/lambda-layer/monorise';
import { Entity as EntityRecord } from '../data/Entity';
import { Mutual } from '../data/Mutual';
import { StandardError, StandardErrorCode } from '../errors/standard-error';
import { parseSQSBusEvent } from '../helpers/event';
import { resolveAsEntity } from '../services/mutual.service';
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

const processEntities = async (
  entityIds: string[],
  action: (id: string) => Promise<void>,
) => Promise.allSettled(entityIds.map(action));

export const handler =
  (container: DependencyContainer) => async (ev: SQSEvent) => {
    const batchItemFailures: SQSBatchItemFailure[] = [];
    const {
      entityRepository,
      mutualRepository,
      publishEvent,
      dynamodbClient,
      entityServiceLifeCycle,
    } = container;

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
            throw new StandardError(
              StandardErrorCode.INVALID_MUTUAL,
              'Invalid mutual',
            );
          }

          const mutualDataProcessor =
            config.mutualDataProcessor ?? (() => ({}));
          const mutualDataSchema = config.mutual?.mutualDataSchema;

          // Resolved once per record — no call-site options exist in this automatic/declarative
          // path, so this always resolves to whatever `createMutualConfig({ asEntity })`
          // declared (or undefined, unchanged from today).
          const asEntity = resolveAsEntity(config.mutual, {});

          // `mutualDataSchema` (finalSchema-derived when `asEntity` is set — see
          // `createMutualConfig`) is kept as-is for `afterCreateEntityHook`'s benefit below (it
          // needs the fuller shape to wire the target entity's own further `mutualFields`).
          // `asEntityStorageSchema`, when present, is what actually gets PARSED AND STORED as
          // this mutual's `mutualData` / the synthetic entity's `data` — narrower on purpose, so
          // the target entity's own further-`mutualFields` keys never get baked into storage. See
          // `MutualService.createMutual`'s matching comment for the full rationale.
          const asEntityStorageSchema = asEntity
            ? (config.mutual?.asEntity?.createSchema ??
                config.mutual?.asEntity?.baseSchema)
            : undefined;

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
              const processedMutualData = mutualDataProcessor(
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
              );
              const parsedMutualData = mutualDataSchema
                ? mutualDataSchema.parse(processedMutualData)
                : processedMutualData;
              // Narrower value for anything actually PERSISTED (mutual.mutualData, the synthetic
              // entity's data) — `parsedMutualData` stays the fuller finalSchema-shaped value for
              // the hook call below. See `asEntityStorageSchema`'s own comment above.
              const storedMutualData = asEntityStorageSchema
                ? asEntityStorageSchema.parse(processedMutualData)
                : parsedMutualData;

              if (!asEntity) {
                // Unchanged path — existing configs (no `asEntity`) are completely unaffected.
                await mutualRepository.createMutual(
                  byEntityType,
                  byEntityId,
                  byEntity.data,
                  entityType,
                  id,
                  entity.data,
                  parsedMutualData,
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
                return;
              }

              // `asEntity` materializes this mutual as a real Entity too — see
              // `MutualConfig.asEntity` (packages/base). Built manually here (rather than
              // delegating to `MutualService.createMutual`) so the mutual Put's idempotency
              // `ConditionExpression` — required because this processor may reprocess/retry
              // events out of order — is preserved unchanged; `MutualService.createMutual` runs
              // an extra `checkMutualExist` guard that would reject exactly the retry/
              // out-of-order scenarios this ConditionExpression is designed to tolerate.
              //
              // NOTE: this branch only ever CREATES the synthetic entity — it does not (and does
              // not need to) handle keeping it in sync afterwards. A later update/delete of THIS
              // mutual (from the `toUpdateEntityIds`/`deletedEntityIds` branches below, or from
              // `MutualService.updateMutual`/`deleteMutual`) is propagated to the synthetic entity
              // by a separate, pre-existing mechanism: DynamoDB Streams replication
              // (`replication-processor.ts`), via the `R2PK` set below (`mutual.mainPk`, i.e.
              // `MUTUAL#<mutualId>`) and the `MUTUAL_REPLICATION_INDEX` GSI. The synthetic entity
              // is therefore a READ-ONLY projection: never `updateEntity`/`deleteEntity` it
              // directly — only ever update/delete the mutual itself. See the "asEntity" section
              // of www/docs/concepts/mutuals.md.
              const currentDatetime = new Date(publishedAt);
              const mutual = new Mutual(
                byEntityType,
                byEntityId,
                byEntity.data,
                entityType,
                id,
                entity.data,
                storedMutualData,
                ulid(),
                currentDatetime,
                currentDatetime,
                currentDatetime,
              );

              const mutualTransactItems = mutualRepository.createMutualTransactItems(
                mutual,
                {
                  ConditionExpression:
                    'attribute_not_exists(#mutualUpdatedAt) OR #mutualUpdatedAt < :publishedAt',
                  ExpressionAttributeNames: {
                    '#mutualUpdatedAt': 'mutualUpdatedAt',
                  },
                  ExpressionAttributeValues: {
                    ':publishedAt': { S: publishedAt },
                  },
                },
              );

              // The synthetic entity always goes into the SAME transaction as the mutual: either
              // both land or neither does, so a committed mutual never exists without its
              // projection. Costs a `TransactWriteItems` (2x WCU, plus some latency) over a plain
              // write; the extra items are ~2 against a 100-item transaction limit.
              const entityRecord = new EntityRecord(
                asEntity,
                mutual.mutualId,
                storedMutualData,
                currentDatetime,
                currentDatetime,
              );
              const entityTransactItems =
                entityRepository.createEntityTransactItems(entityRecord, {
                  mutualId: mutual.mainPk,
                });

              // Raw SDK call (not `dbUtils.executeTransactWrite`) so a benign
              // conditional-check failure surfaces as `TransactionCanceledException` — the
              // shape this handler's catch-all already treats as ignorable out-of-order-event
              // noise (see below), matching `mutualRepository.createMutual`'s own un-wrapped
              // call in the branch above.
              await dynamodbClient.transactWriteItems({
                TransactItems: [...mutualTransactItems, ...entityTransactItems],
              });

              // `parsedMutualData` (the fuller, mutualDataSchema/finalSchema-shaped value), NOT
              // the narrowed `storedMutualData`: the hook parses what it's given with
              // `effectiveMutualSchema` to wire the synthetic entity's OWN further
              // `mutualFields`, so the narrowed value would silently drop that wiring. Keep
              // `storedMutualData` for what is actually written to storage (`new Mutual(...)` /
              // `new EntityRecord(...)` above).
              await entityServiceLifeCycle.afterCreateEntityHook(
                entityRecord,
                parsedMutualData,
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
              const processedMutualData = mutualDataProcessor(
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
              );
              const parsedMutualData = mutualDataSchema
                ? mutualDataSchema.parse(processedMutualData)
                : processedMutualData;
              // Same narrowing as the addEntities branch — an update to an `asEntity` mutual
              // must not persist the target entity's own further-`mutualFields` keys either.
              const storedMutualData = asEntityStorageSchema
                ? asEntityStorageSchema.parse(processedMutualData)
                : parsedMutualData;
              await mutualRepository.updateMutual(
                byEntityType,
                byEntityId,
                entityType,
                id,
                {
                  mutualData: storedMutualData,
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
                    res.reason.code === StandardErrorCode.MUTUAL_NOT_FOUND)
                ),
            )
          ) {
            throw new StandardError(
              StandardErrorCode.MUTUAL_PROCESSOR_ERROR,
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
            (err.code === StandardErrorCode.INVALID_MUTUAL ||
              err.code === StandardErrorCode.MUTUAL_LOCK_CONFLICT)
          ) {
            return;
          }

          batchItemFailures.push({ itemIdentifier: record.messageId });
        }
      }),
    );

    return { batchItemFailures };
  };
