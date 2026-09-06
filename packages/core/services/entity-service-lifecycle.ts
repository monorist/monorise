import type { Entity as EntityType } from '@monorise/base';
import type { Entity } from '../data/Entity';
import type { EventUtils } from '../data/EventUtils';
import type { publishEvent as publishEventType } from '../helpers/event';
import { EVENT } from '../types/event';

export class EntityServiceLifeCycle {
  constructor(
    private EntityConfig: any,
    private publishEvent: typeof publishEventType,
    private eventUtils: EventUtils,
  ) {}

  async afterCreateEntityHook<T extends EntityType>(
    entity: Entity<T>,
    entityPayload?: Record<string, unknown>,
    accountId?: string | string[],
  ) {
    const mutual = this.EntityConfig[entity.entityType].mutual;
    // Prefer createMutualSchema (stricter, create-only) if the config
    // defines one — falls back to the ordinary mutualSchema (kept .partial()
    // for updates) so existing configs are unaffected.
    const mutualSchema = mutual?.createMutualSchema || mutual?.mutualSchema;
    const parsedMutualPayload = mutualSchema?.parse(entityPayload);

    if (parsedMutualPayload) {
      await this.eventUtils.publishCreateMutualsEvent({
        entity,
        mutualPayload: parsedMutualPayload,
      });
    }

    await this.publishEvent({
      event: EVENT.CORE.ENTITY_CREATED,
      payload: {
        entityType: entity.entityType,
        entityId: entity.entityId,
        data: entity.data,
        createdByAccountId: accountId,
        publishedAt: entity.updatedAt || new Date().toISOString(),
      },
    });
  }
}
