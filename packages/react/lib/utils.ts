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

export const getMutualStateKey = (
  byEntity: Entity,
  byEntityId: string | null,
  entity: Entity,
  entityId?: string,
  chainEntityQuery?: string,
) => {
  return `${byEntity}/${byEntityId}/${entity}${entityId ? `/${entityId}` : ''}${chainEntityQuery ? `?${chainEntityQuery}` : ''}`;
};

export const getTagStateKey = (
  entityType: Entity,
  tagName: string,
  params: Record<string, string> = {},
) => {
  const paramsKey = Object.keys(params)
    .map((key) => `${key}:${params[key]}`)
    .join('/');

  return `${entityType}/${tagName}/${paramsKey}`;
};

export const getUniqueFieldStateKey = (
  fieldName: string,
  fieldValue: string,
) => {
  return `${fieldName}/${fieldValue}`;
};
