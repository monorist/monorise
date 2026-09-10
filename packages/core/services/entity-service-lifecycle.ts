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
    // effectiveMutualSchema is precomputed once by createEntityConfig — see
    // resolveEffectiveMutualSchema (packages/base/utils) for why it's a
    // merge, not a replace. Fallback to the raw mutualSchema (today's
    // pre-createMutualSchema behavior) when effectiveMutualSchema is
    // missing — e.g. this EntityConfig was built by an older
    // @monorise/base that doesn't attach it — so a version-mismatch
    // silently disables mutual-create events for every entity, not just
    // ones using createMutualSchema.
    const config = this.EntityConfig[entity.entityType];
    const mutualSchema = config?.effectiveMutualSchema ?? config?.mutual?.mutualSchema;
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
