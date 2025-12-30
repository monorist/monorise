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
  const { lastKey, ...stateParams } = params;

  const paramsKey = Object.keys(stateParams)
    .map((key) => `${key}:${stateParams[key]}`)
    .join('/');

  return `${entityType}/${tagName}/${paramsKey}`;
};

export const getUniqueFieldStateKey = (
  fieldName: string,
  fieldValue: string,
) => {
  return `${fieldName}/${fieldValue}`;
};

export const getEntityRequestKey = (
  mode: 'create' | 'upsert' | 'edit' | 'delete' | 'get' | 'list' | 'search',
  entityType: Entity,
  entityId?: string,
) => {
  return `entity/${entityType}/${mode}${entityId ? `/${entityId}` : ''}`;
};

export const getMutualRequestKey = (
  mode: 'create' | 'update' | 'delete' | 'get' | 'list',
  byEntityType: Entity,
  entityType: Entity,
  byEntityId: string | null,
  entityId?: string,
  chainEntityQuery?: string,
) => {
  return `mutual/${getMutualStateKey(byEntityType, byEntityId, entityType, entityId, chainEntityQuery)}/${mode}`;
};

export const getTagRequestKey = (
  mode: 'list',
  entityType: Entity,
  tagName: string,
  params: Record<string, string> = {},
) => {
  return `tag/${getTagStateKey(entityType, tagName, params)}/${mode}`;
};

export const getUniqueFieldRequestKey = (
  entityType: Entity,
  fieldName: string,
  value: string,
) => {
  return `entity/${entityType}/unique/${getUniqueFieldStateKey(fieldName, value)}`;
};
