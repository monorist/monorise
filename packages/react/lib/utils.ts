import type { Entity } from '@monorise/base';

export const convertToMap = <T extends Record<string, any>>(
  data: T[],
  mapKey: string,
) => {
  const map = new Map();

  for (const i in data) {
    map.set(data[i][mapKey], data[i]);
  }

  return map;
};

export const mutualStateKey = (
  byEntity: Entity,
  byEntityId: string | null,
  entity: Entity,
  entityId?: string,
  chainEntityQuery?: string,
) => {
  return `${byEntity}/${byEntityId}/${entity}${entityId ? `/${entityId}` : ''}${chainEntityQuery ? `?${chainEntityQuery}` : ''}`;
};

export const tagStateKey = (
  entityType: Entity,
  tagName: string,
  group?: string,
) => {
  return `${entityType}/${tagName}/${group || ''}`;
};
