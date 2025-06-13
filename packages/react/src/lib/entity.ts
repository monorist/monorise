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

export const flipMutual = (mutual: Mutual): Mutual => {
  return {
    ...mutual,
    entityId: mutual.byEntityId,
    entityType: mutual.byEntityType,
    byEntityId: mutual.entityId,
    byEntityType: mutual.entityType,
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
