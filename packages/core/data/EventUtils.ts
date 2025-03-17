import type { Entity as EntityType } from '@monorise/base';
// import { EntityConfig } from '#/lambda-layer/monorise';
import type { publishEvent as publishEventType } from '../helpers/event';
import { EVENT } from '../types/event';
import type { Entity } from './Entity';

type PublishEventProps<T extends EntityType> = {
  entity: Entity<T>;
  mutualPayload: Record<string, any>;
};

export class EventUtils {
  constructor(
    public EntityConfig: any,
    private publishEvent: typeof publishEventType,
  ) {}

  // Always when create entity, this must be called following, to make sure mutual data processor will be called
  publishCreateMutualsEvent = async <T extends EntityType>({
    entity,
    mutualPayload,
  }: PublishEventProps<T>) => {
    const publishEventPromises = [];
    for (const [fieldKey, config] of Object.entries(
      this.EntityConfig[entity.entityType].mutual?.mutualFields || {},
    )) {
      const toMutualIds = config.toMutualIds;
      const mutualPayloadByFieldKey = mutualPayload[fieldKey];
      if (!mutualPayloadByFieldKey) continue;

      publishEventPromises.push(
        this.publishEvent({
          event: EVENT.CORE.ENTITY_MUTUAL_TO_CREATE,
          payload: {
            byEntityType: entity.entityType,
            byEntityId: entity.entityId,
            entityType: config.entityType,
            field: fieldKey,
            mutualIds: toMutualIds
              ? toMutualIds(mutualPayloadByFieldKey)
              : mutualPayloadByFieldKey,
            customContext: toMutualIds ? mutualPayloadByFieldKey : {},
            publishedAt: entity.updatedAt || new Date().toISOString(),
          },
        }),
      );
    }
    await Promise.allSettled(publishEventPromises);
  };
}
