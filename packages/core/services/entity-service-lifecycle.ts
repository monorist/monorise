import { resolveEffectiveMutualSchema } from '@monorise/base';
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
    // Merge createMutualSchema (stricter, create-only) into mutualSchema
    // rather than replacing it — a plain fallback would drop any mutual
    // field mutualSchema declares but createMutualSchema omits, silently
    // skipping that field's wiring even when the caller supplied it. See
    // resolveEffectiveMutualSchema's own doc comment for the full reasoning.
    const mutualSchema = resolveEffectiveMutualSchema(
      mutual?.mutualSchema,
      mutual?.createMutualSchema,
    );
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
