import type { CreatedEntity, Entity, EntitySchemaMap } from '@monorise/base';
import type { Mutual, MutualData } from '../types/mutual.type';

export const constructLocal = (
  entityType: Entity,
  entityId: string,
  data: any,
): CreatedEntity<Entity> => {
  return {
    entityType: entityType as unknown as string,
    entityId,
    data,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
};

export const constructMutual = <B extends Entity, T extends Entity>(
  byEntityType: B,
  byEntityId: string,
  entityType: T,
  entityId: string,
  mutualData: Partial<MutualData<B, T>>,
  data: EntitySchemaMap[T],
): Mutual => {
  return {
    mutualId: `${byEntityId}-${entityId}`,
    byEntityType,
    byEntityId,
    entityType,
    entityId,
    mutualData,
    data,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    mutualUpdatedAt: new Date().toISOString(),
  };
};

// A mutual is stored under two cache keys — one per direction. When we mirror
// a record from the `BY/byId/OTHER` side to the `OTHER/otherId/BY` side, the
// `data` field has to be substituted: on the original side `data` describes
// the OTHER entity (the one at `entityType/entityId`); after flipping, the
// new `entityType/entityId` points to what *was* the BY entity, so `data`
// must now describe that entity. Callers look up the BY entity from the
// entity store and pass its data in here. `{}` is an accepted fallback for
// the case where the BY entity hasn't been hydrated locally yet — better to
// surface an empty record than to leak the OTHER entity's fields onto a
// record that no longer describes it.
export const flipMutual = (
  mutual: Mutual,
  byEntityData: Record<string, unknown>,
): Mutual => {
  return {
    ...mutual,
    entityId: mutual.byEntityId,
    entityType: mutual.byEntityType,
    byEntityId: mutual.entityId,
    byEntityType: mutual.entityType,
    data: byEntityData as Mutual['data'],
  };
};

export const byMutualIndex = (a: Mutual<any, any>, b: Mutual<any, any>) => {
  return a.mutualData.index - b.mutualData.index;
};

export const byEntityId = (a: CreatedEntity<any>, b: CreatedEntity<any>) => {
  if (b.entityId < a.entityId) return -1;
  return 1;
};

export const constructOrderByIndex = (mutuals: Mutual<any, any>[]) => {
  return mutuals.sort(byMutualIndex).map((mutual) => mutual.entityId);
};

export const injectFields = <T extends Entity>(
  entity: CreatedEntity<T> | undefined,
  fields: Record<string, any>,
): CreatedEntity<T> | undefined => {
  return entity
    ? {
        ...entity,
        data: {
          ...entity.data,
          ...fields,
        },
      }
    : undefined;
};
