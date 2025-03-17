import type { Entity as EntityType } from '@monorise/base';
// import { EntityConfig } from '#/lambda-layer/monorise';
import type { Entity } from '../data/Entity';
import type { EventUtils } from '../data/EventUtils';
import type { publishEvent as publishEventType } from '../helpers/event';
import { EVENT } from '../types/event';
import type { DependencyContainer } from './DependencyContainer';

export const afterCreateEntityHook =
  (container: DependencyContainer) =>
  async <T extends EntityType>({
    entity,
    entityPayload = {},
    accountId,
    publishEvent,
    eventUtils,
  }: {
    entity: Entity<T>;
    entityPayload?: Record<string, unknown>;
    accountId?: string | string[];
    publishEvent: typeof publishEventType;
    eventUtils: EventUtils;
  }) => {
    const mutualSchema = container.EntityConfig[entity.entityType].mutual?.mutualSchema;
    const parsedMutualPayload = mutualSchema?.parse(entityPayload);

    if (parsedMutualPayload) {
      await eventUtils.publishCreateMutualsEvent({
        entity,
        mutualPayload: parsedMutualPayload,
      });
    }

    await publishEvent({
      event: EVENT.CORE.ENTITY_CREATED,
      payload: {
        entityType: entity.entityType,
        entityId: entity.entityId,
        data: entity.data,
        createdByAccountId: accountId,
        publishedAt: entity.updatedAt || new Date().toISOString(),
      },
    });
  };
