import type { TransactWriteItem } from '@aws-sdk/client-dynamodb';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import type { Entity } from '@monorise/base';
import type { SQSBatchItemFailure, SQSEvent } from 'aws-lambda';
import { ulid } from 'ulid';
// import { EntityConfig } from '#/lambda-layer/monorise';
import { Entity as EntityRecord } from '../data/Entity';
import { Mutual } from '../data/Mutual';
import { StandardError, StandardErrorCode } from '../errors/standard-error';
import { parseSQSBusEvent } from '../helpers/event';
import { resolveAsEntityOptions } from '../services/mutual.service';
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
          // path, so this always resolves to whatever `createMutualConfig({ asEntity, ... })`
          // declared (or undefined, unchanged from today).
          const { asEntity, ensureEntityStrongConsistentWrite } =
            resolveAsEntityOptions(config.mutual, {});

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
          // Keyed for the `toUpdateEntityIds` self-heal check below — each already-existing
          // mutual's OWN `mutualId` (the synthetic entity's entityId when `asEntity` is set),
          // not the target entity's id.
          const mutualIdByEntityId = new Map(
            mutuals.items.map((m) => [m.entityId, m.mutualId]),
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

              let entityRecord: InstanceType<typeof EntityRecord> | undefined;
              let entityTransactItems: TransactWriteItem[] = [];
              if (ensureEntityStrongConsistentWrite) {
                entityRecord = new EntityRecord(
                  asEntity,
                  mutual.mutualId,
                  storedMutualData,
                  currentDatetime,
                  currentDatetime,
                );
                entityTransactItems = entityRepository.createEntityTransactItems(
                  entityRecord,
                  { mutualId: mutual.mainPk },
                );
              }

              // Raw SDK call (not `dbUtils.executeTransactWrite`) so a benign
              // conditional-check failure surfaces as `TransactionCanceledException` — the
              // shape this handler's catch-all already treats as ignorable out-of-order-event
              // noise (see below), matching `mutualRepository.createMutual`'s own un-wrapped
              // call in the branch above.
              await dynamodbClient.transactWriteItems({
                TransactItems: [...mutualTransactItems, ...entityTransactItems],
              });

              if (ensureEntityStrongConsistentWrite && entityRecord) {
                await entityServiceLifeCycle.afterCreateEntityHook(
                  entityRecord,
                  parsedMutualData,
                );
              } else {
                await publishEvent({
                  event: EVENT.CORE.CREATE_ENTITY,
                  payload: {
                    entityType: asEntity,
                    entityId: mutual.mutualId,
                    // `parsedMutualData` (the fuller, mutualDataSchema/finalSchema-shaped
                    // value), NOT the narrowed `storedMutualData` — this is a PAYLOAD, not
                    // something persisted. `entityService.createEntity` does its own
                    // `entitySchema.parse` before writing, so the narrowing is applied there
                    // anyway; but it ALSO does `finalSchema.parse(entityPayload)` first and
                    // then hands the UNSTRIPPED `entityPayload` to `afterCreateEntityHook`,
                    // which parses it with `effectiveMutualSchema` to wire the synthetic
                    // entity's OWN further `mutualFields`. Narrowing here would therefore
                    // (a) silently stop those mutualFields from ever firing on this async
                    // path while the strong-write branch above still fires them, and
                    // (b) hard-fail `finalSchema.parse` — and DLQ the record — whenever the
                    // target entity declares a REQUIRED `createMutualSchema` field, since
                    // `finalSchema` requires the very key `storedMutualData` strips.
                    // Keep `storedMutualData` for what is actually written to storage
                    // (`new Mutual(...)` / `new EntityRecord(...)` above).
                    entityPayload: parsedMutualData,
                    options: {
                      createAndUpdateDatetime: mutual.createdAt,
                      mutualId: mutual.mutualId,
                    },
                  },
                });
              }
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

              // Self-heals a specific retry gap: if a PRIOR attempt already committed this
              // mutual's (+ its synthetic entity's, on the strong-write path) creation but the
              // post-commit `afterCreateEntityHook`/`CREATE_ENTITY` publish then failed, this id
              // no longer appears in `addedEntityIds` on retry (the mutual now exists, so it's
              // here in `toUpdateEntityIds` instead) — and would otherwise never get its
              // synthetic entity (async path: entity was never created at all) or its hook side
              // effects re-attempted, silently, forever. Only acts when the entity is actually
              // missing, so this never fires on an ordinary update where entity creation already
              // succeeded. Does not cover the narrower case where the strong-write path's
              // transaction succeeded (entity exists) but only its `afterCreateEntityHook` call
              // failed — that's not detectable from entity existence alone; a known remaining
              // gap, not silently claimed fixed here.
              //
              // Gated on `!ensureEntityStrongConsistentWrite` so the per-id `getEntity` is only
              // paid where it can actually find anything: on the strong-write path the synthetic
              // entity is created in the SAME `transactWriteItems` call as the mutual, so a
              // mutual reaching this branch (i.e. one that exists) always has its entity too —
              // the lookup can only ever come back "exists", making it pure cost on every event.
              // Only the async path can leave a committed mutual with no entity. Tradeoff stated
              // plainly: this also means flipping an existing config from async to
              // `ensureEntityStrongConsistentWrite: true` stops back-filling entities for mutuals
              // created while it was async — that's a migration/backfill concern, not the
              // post-commit retry gap this self-heal exists for, and it was never reliably
              // covered anyway (it only healed ids that happened to be re-published).
              if (asEntity && !ensureEntityStrongConsistentWrite) {
                const mutualId = mutualIdByEntityId.get(id);
                if (mutualId) {
                  const entityExists = await entityRepository
                    .getEntity(asEntity, mutualId)
                    .then(() => true)
                    .catch((err) => {
                      if (
                        err instanceof StandardError &&
                        err.code === StandardErrorCode.ENTITY_IS_UNDEFINED
                      ) {
                        return false;
                      }
                      throw err;
                    });

                  if (!entityExists) {
                    await publishEvent({
                      event: EVENT.CORE.CREATE_ENTITY,
                      payload: {
                        entityType: asEntity,
                        entityId: mutualId,
                        // Same reasoning as the `addEntities` branch's CREATE_ENTITY publish:
                        // the fuller `parsedMutualData`, not the storage-narrowed value — this
                        // is re-driving the exact event that was lost, so it must carry the
                        // shape `createEntity`'s `finalSchema.parse` + `afterCreateEntityHook`
                        // need. Publishing `storedMutualData` here would make the self-heal
                        // produce an entity with its own `mutualFields` unwired, or DLQ on a
                        // required `createMutualSchema` field.
                        entityPayload: parsedMutualData,
                        options: {
                          createAndUpdateDatetime: publishedAt,
                          mutualId,
                        },
                      },
                    });
                  }
                }
              }
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
