import type { CreatedEntity, Entity as EntityType } from '@monorise/base';
import type { SQSBatchItemFailure, SQSEvent } from 'aws-lambda';
import { EntityConfig } from '#/lambda-layer/monorise';
import type { Entity } from '../data/Entity';
import { parseSQSBusEvent } from '../helpers/event';
import { DependencyContainer } from '../services/DependencyContainer';
import type { Tag } from '../types/entity.type';

export type EventDetailBody = {
  entityType: EntityType;
  entityId: string;
  data: Record<string, any>;
};

const container = new DependencyContainer();

function compareTags(
  existingTags: Tag[],
  newTags: Tag[],
): {
  old: Tag[];
  new: Tag[];
  remain: Tag[];
} {
  const oldMap = new Map(
    existingTags.map((item) => [`${item.group}#${item.sortValue}`, item]),
  );
  const newMap = new Map(
    newTags.map((item) => [`${item.group}#${item.sortValue}`, item]),
  );

  const remain: Tag[] = [];
  const oldDiff: Tag[] = [];
  const newDiff: Tag[] = [];

  for (const [key, oldItem] of oldMap.entries()) {
    if (newMap.has(key)) {
      remain.push(oldItem);
      newMap.delete(key); // Remove from newMap as it's already in remain
    } else {
      oldDiff.push(oldItem);
    }
  }

  // Remaining entries in newMap are new
  for (const newItem of newMap.values()) {
    newDiff.push(newItem);
  }

  return {
    old: oldDiff,
    new: newDiff,
    remain,
  };
}

async function batchUpdateTags({
  tagName,
  entity,
  diff,
}: {
  tagName: string;
  entity: Entity<EntityType>;
  diff: { old: Tag[]; new: Tag[] };
}): Promise<void> {
  if (!entity.entityId) {
    throw new Error('entityId is required');
  }

  const { old: tagsToRemove, new: tagsToAdd } = diff;
  const { entityType, entityId } = entity;

  const removePromises = tagsToRemove.reduce(
    (acc, tag) => [
      ...acc,
      container.tagRepository.deleteTag({
        tagName,
        group: tag.group,
        sortValue: tag.sortValue,
        entityType,
        entityId,
      }),
    ],
    [] as Promise<any>[],
  );

  const addPromises = tagsToAdd.reduce(
    (acc, tag) => [
      ...acc,
      container.tagRepository.createTag({
        tagName,
        group: tag.group,
        sortValue: tag.sortValue,
        entity,
      }),
    ],
    [] as Promise<any>[],
  );

  await Promise.all([...removePromises, ...addPromises]);
}

export const handler = async (ev: SQSEvent) => {
  const batchItemFailures: SQSBatchItemFailure[] = [];

  for (const record of ev.Records) {
    const body = parseSQSBusEvent<EventDetailBody>(record.body);
    const { detail } = body;
    const { entityType, entityId } = detail;

    const errorContext: Record<string, unknown> = {};
    errorContext.body = body;

    try {
      const tagConfigs = EntityConfig[entityType]?.tags;

      if (!tagConfigs || !tagConfigs.length) {
        // skip if entity has no tag configs
        continue;
      }

      await container.tagRepository.createLock({
        entityType,
        entityId,
      });

      for (const tagConfig of tagConfigs) {
        const { name, processor } = tagConfig;

        const existingTags = await container.tagRepository.getExistingTags({
          entityType,
          entityId,
          tagName: name,
        });
        errorContext.existingTags = existingTags;

        const entity = await container.entityRepository.getEntity(
          entityType,
          entityId,
        );
        errorContext.entity = entity;

        const newTags = await processor(
          entity as unknown as CreatedEntity<EntityType>,
        );
        errorContext.newTags = newTags;

        const diff = compareTags(existingTags, newTags);
        errorContext.diff = diff;

        await batchUpdateTags({
          tagName: name,
          entity,
          diff,
        });
      }

      await container.tagRepository.deleteLock({
        entityType,
        entityId,
      });
    } catch (err) {
      console.log(
        '===TAG-PROCESSOR ERROR===',
        err,
        JSON.stringify({ errorContext }, null, 2),
      );

      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};
