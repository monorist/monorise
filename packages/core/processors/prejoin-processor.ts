import type { Entity } from '@monorise/base';
import type { SQSBatchItemFailure, SQSEvent } from 'aws-lambda';
import type { MutualRepository } from '../data/Mutual';
import { PROJECTION_EXPRESSION } from '../data/ProjectionExpression';
import { parseSQSBusEvent } from '../helpers/event';
import type { publishEvent as publishEventType } from '../helpers/event';
import type { EventDetailBody as MutualProcessorEventDetailBody } from '../processors/mutual-processor';
import type { DependencyContainer } from '../services/DependencyContainer';
import type { Prejoins } from '../types/entity.type';
import { EVENT } from '../types/event';

export type EventDetailBody = {
  byEntityType: Entity;
  byEntityId: string;
  entityType: Entity;
  publishedAt: string;
};

async function processPrejoins({
  mutualRepository,
  publishEvent,
  byEntityType,
  byEntityId,
  prejoins,
  publishedAt,
}: {
  mutualRepository: MutualRepository;
  publishEvent: typeof publishEventType;
  byEntityType: Entity;
  byEntityId: string;
  prejoins: Prejoins;
  publishedAt: string;
}) {
  const mutualCache: Partial<
    Record<
      Entity,
      Array<{
        byEntityType?: Entity;
        byEntityId?: string;
        entityType: Entity;
        entityId: string;
      }>
    >
  > = {
    /*
        course: [{
            byEntityType: 'module',
            byEntityId: '1',
            entityType: 'course',
            entityId: '1',
        }],
        module: [],
        chapter: [],
        video: []
    */
  };

  //initiate
  mutualCache[byEntityType] = [
    {
      entityType: byEntityType,
      entityId: byEntityId,
    },
  ];

  for (const { mutualField, targetEntityType, entityPaths } of prejoins) {
    let toBePublishedContext: Record<string, any> = {};

    for (const [index, entityPath] of entityPaths.entries()) {
      const entityType = entityPath.entityType as keyof typeof mutualCache;

      // skip cached
      if (!entityPath.skipCache && mutualCache[entityType]) {
        continue;
      }

      // if skipping cache should not have previous run data
      mutualCache[entityType] = [];

      const parentEntityType = entityPaths[index - 1]
        .entityType as keyof typeof mutualCache;
      const parentEntities = mutualCache[parentEntityType] ?? [];

      // find all nested entities
      for (const parentEntity of parentEntities) {
        const { entityType: parentEntityType, entityId: parentEntityId } =
          parentEntity;

        const { items: mutualItems } =
          await mutualRepository.listEntitiesByEntity(
            parentEntityType,
            parentEntityId,
            entityPath.entityType,
            {
              ProjectionExpression: PROJECTION_EXPRESSION.MUTUAL_DATA_ONLY,
            },
          );

        // custom processor defined in prejoin config for each path
        const processor =
          entityPath.processor || ((items, context) => ({ items, context }));

        const processed = processor(mutualItems, toBePublishedContext);
        toBePublishedContext = processed?.context || toBePublishedContext;

        mutualCache[entityType] = [
          ...(mutualCache[entityType] ?? []),
          ...(processed ? processed.items : mutualItems),
        ];
      }

      if (!mutualCache[entityType] && !Array.isArray(mutualCache[entityType])) {
        // to avoid empty array
        mutualCache[entityType] = [];
      }
    }

    const mutualIds = (
      mutualCache[targetEntityType as keyof typeof mutualCache] ?? []
    ).map((item) => item.entityId);

    await publishEvent<MutualProcessorEventDetailBody>({
      event: EVENT.CORE.ENTITY_MUTUAL_TO_UPDATE,
      payload: {
        byEntityType,
        byEntityId,
        entityType: targetEntityType,
        field: mutualField,
        mutualIds,
        customContext: toBePublishedContext,
        publishedAt,
      },
    });
  }
}

async function publishToSubscribers({
  container,
  publishEvent,
  byEntityType,
  byEntityId,
  publishedAt,
}: {
  container: DependencyContainer;
  publishEvent: typeof publishEventType;
  byEntityType: Entity;
  byEntityId: string;
  publishedAt: string;
}) {
  const listeners = container.AllowedEntityTypes.reduce(
    (acc, configKey) => {
      const { subscribes } = container.EntityConfig[configKey].mutual ?? {};

      const hasSubscription = (subscribes ?? []).some(
        ({ entityType }) => entityType === byEntityType,
      );

      return [
        ...acc,
        ...(hasSubscription
          ? [
              {
                entityType: configKey,
              },
            ]
          : []),
      ];
    },
    [] as { entityType: Entity }[],
  );

  // publish event for each interested entity
  const subscribedMutualItems = await Promise.all(
    listeners.map(({ entityType: subscribedEntityType }) =>
      container.mutualRepository.listEntitiesByEntity(
        byEntityType,
        byEntityId,
        subscribedEntityType,
        {
          ProjectionExpression: PROJECTION_EXPRESSION.NO_DATA,
        },
      ),
    ),
  );
  const subscribedMutuals = subscribedMutualItems.flatMap((item) => item.items);

  await Promise.all(
    subscribedMutuals.map((subscribedMutual) =>
      publishEvent({
        event: EVENT.CORE.PREJOIN_RELATIONSHIP_SYNC,
        payload: {
          byEntityType: subscribedMutual.entityType,
          byEntityId: subscribedMutual.entityId,
          entityType: subscribedMutual.byEntityType,
          publishedAt,
        },
      }),
    ),
  );
}

export const handler =
  (container: DependencyContainer) => async (ev: SQSEvent) => {
    const batchItemFailures: SQSBatchItemFailure[] = [];

    const { mutualRepository, publishEvent } = container;

    for (const record of ev.Records) {
      const body = parseSQSBusEvent<EventDetailBody>(record.body);
      const { detail } = body;
      const { byEntityType, byEntityId, entityType, publishedAt } = detail;
      let errorContext: Record<string, unknown> = {
        body,
      };

      try {
        const isEntityTypeSubscribed = (
          container.EntityConfig[byEntityType]?.mutual?.subscribes ?? []
        ).some(
          ({ entityType: subscribedEntityType }) =>
            subscribedEntityType === entityType,
        );
        const hasPrejoins = container.EntityConfig[byEntityType]?.mutual?.prejoins;
        const shouldProcessPrejoins = isEntityTypeSubscribed && hasPrejoins;
        errorContext = {
          ...errorContext,
          isEntityTypeSubscribed,
          hasPrejoins,
          shouldProcessPrejoins,
        };

        if (shouldProcessPrejoins) {
          await processPrejoins({
            mutualRepository,
            publishEvent,
            byEntityType,
            byEntityId,
            prejoins: container.EntityConfig[byEntityType]?.mutual?.prejoins ?? [],
            publishedAt,
          });
        }

        await publishToSubscribers({
          container,
          publishEvent,
          byEntityType,
          byEntityId,
          publishedAt,
        });
      } catch (err) {
        console.log(
          '===PREJOIN-PROCESSOR ERROR===',
          err,
          JSON.stringify({ errorContext }, null, 2),
        );

        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }

    return { batchItemFailures };
  };
