import type { CreatedEntity, DraftEntity, Entity } from '@monorise/base';
import type { AxiosRequestConfig } from 'axios';
import {
  getEntityRequestKey,
  getMutualRequestKey,
  getMutualStateKey,
  getTagRequestKey,
  getUniqueFieldRequestKey,
  getUniqueFieldStateKey,
} from '../lib/utils';
import type { MonoriseStore } from '../store/monorise.store';
import type { AxiosInterceptor } from '../types/api.type';
import type { Mutual, MutualData } from '../types/mutual.type';

const ENTITY_API_BASE_URL = '/api/core/entity';
const MUTUAL_API_BASE_URL = '/api/core/mutual';
const TAG_API_BASE_URL = '/api/core/tag';

type ListEntitiesPayload = {
  limit?: number;
  lastKey?: string;
  start?: string;
  end?: string;
};

export type ListEntitiesByTagParams = {
  group?: string;
  query?: string;
  start?: string;
  end?: string;
  limit?: number;
  lastKey?: string;
};

type ConfigOptions = {
  entityApiBaseUrl?: string;
  mutualApiBaseUrl?: string;
  tagApiBaseUrl?: string;
};

export type CommonOptions = Partial<AxiosRequestConfig> & {
  customUrl?: string;
  isInterruptive?: boolean;
  feedback?: {
    success?: string;
    failure?: string;
    loading?: string;
  };
  stateKey?: string;
  forceFetch?: boolean;
  noData?: boolean;
  requestKey?: string;
  onError?: (error: Error | unknown) => void;
};

const initCoreService = (
  monoriseStore: MonoriseStore,
  axios: AxiosInterceptor,
  opts?: ConfigOptions,
) => {
  let options: ConfigOptions = opts || {};

  const listEntities = <T extends Entity>(
    entityType: T,
    payload?: ListEntitiesPayload,
    opts: CommonOptions = {},
  ) => {
    const { entityApiBaseUrl = ENTITY_API_BASE_URL } = options;
    return axios.get<{
      data: CreatedEntity<T>[];
      lastKey?: string;
      totalCount: number;
    }>(opts.customUrl || `${entityApiBaseUrl}/${entityType}`, {
      requestKey: getEntityRequestKey('list', entityType),
      params: payload ?? undefined,
      isInterruptive: opts.isInterruptive,
      feedback: opts.feedback,
    });
  };

  const searchEntities = <T extends Entity>(
    entityType: T,
    query: string,
    opts: CommonOptions = {},
  ) => {
    const { entityApiBaseUrl = ENTITY_API_BASE_URL } = options;
    return axios.get<{ data: CreatedEntity<T>[] }>(
      opts.customUrl || `${entityApiBaseUrl}/${entityType}`,
      {
        requestKey: getEntityRequestKey('search', entityType),
        params: { query },
        isInterruptive: opts.isInterruptive,
        feedback: opts.feedback,
      },
    );
  };

  const listEntitiesByTag = <T extends Entity>(
    entityType: T,
    tagName: string,
    opts: CommonOptions & { params?: ListEntitiesByTagParams } = {},
  ) => {
    const { tagApiBaseUrl = TAG_API_BASE_URL } = options;
    return axios.get<{ entities: CreatedEntity<T>[]; lastKey: string }>(
      opts.customUrl || `${tagApiBaseUrl}/${entityType}/${tagName}`,
      {
        requestKey:
          opts.requestKey ||
          getTagRequestKey('list', entityType, tagName, opts.params),
        params: opts.params,
        isInterruptive: opts.isInterruptive,
        feedback: opts.feedback,
      },
    );
  };

  const getEntity = <T extends Entity>(
    entityType: T,
    id: string,
    opts: CommonOptions = {},
  ) => {
    const { entityApiBaseUrl = ENTITY_API_BASE_URL } = options;
    return axios.get<CreatedEntity<T>>(
      opts.customUrl || `${entityApiBaseUrl}/${entityType}/${id}`,
      {
        requestKey: getEntityRequestKey('get', entityType, id),
        isInterruptive: opts.isInterruptive,
        feedback: {
          loading: `Retrieving ${entityType}`,
          ...(opts.feedback || {}),
        },
      },
    );
  };

  const getEntityByUniqueField = <T extends Entity>(
    entityType: T,
    fieldName: string,
    value: string,
    opts: CommonOptions = {},
  ) => {
    const { entityApiBaseUrl = ENTITY_API_BASE_URL } = options;
    return axios.get<CreatedEntity<T>>(
      opts.customUrl ||
        `${entityApiBaseUrl}/${entityType}/unique/${getUniqueFieldStateKey(fieldName, value)}`,
      {
        requestKey: getUniqueFieldRequestKey(entityType, fieldName, value),
        isInterruptive: opts.isInterruptive,
        feedback: {
          loading: `Retrieving ${entityType}`,
          ...(opts.feedback || {}),
        },
      },
    );
  };

  const createEntity = <T extends Entity>(
    entityType: T,
    values: DraftEntity<T>,
    opts: CommonOptions = {},
  ) => {
    const { entityApiBaseUrl = ENTITY_API_BASE_URL } = options;
    const entityConfig = monoriseStore.getState().config;
    return axios.post<CreatedEntity<T>>(
      opts.customUrl || `${entityApiBaseUrl}/${entityType}`,
      values,
      {
        requestKey: opts.requestKey || getEntityRequestKey('create', entityType),
        isInterruptive: opts.isInterruptive ?? true,
        feedback: {
          loading: `Creating ${entityConfig[entityType].displayName}`,
          success: `${entityConfig[entityType].displayName} created`,
          ...(opts.feedback || {}),
        },
      },
    );
  };

  const upsertEntity = <T extends Entity>(
    entityType: T,
    id: string,
    values: DraftEntity<T>,
    opts: CommonOptions = {},
  ) => {
    const { entityApiBaseUrl = ENTITY_API_BASE_URL } = options;
    const entityConfig = monoriseStore.getState().config;
    return axios.put<CreatedEntity<T>>(
      opts.customUrl || `${entityApiBaseUrl}/${entityType}/${id}`,
      values,
      {
        requestKey: getEntityRequestKey('upsert', entityType, id),
        isInterruptive: opts.isInterruptive ?? true,
        feedback: {
          loading: `Updating ${entityConfig[entityType].displayName}`,
          success: `${entityConfig[entityType].displayName} updated`,
          ...(opts.feedback || {}),
        },
      },
    );
  };

  const editEntity = <T extends Entity>(
    entityType: T,
    id: string,
    values: Partial<DraftEntity<T>>,
    opts: CommonOptions = {},
  ) => {
    const { entityApiBaseUrl = ENTITY_API_BASE_URL } = options;
    const entityConfig = monoriseStore.getState().config;
    return axios.patch<CreatedEntity<T>>(
      opts.customUrl || `${entityApiBaseUrl}/${entityType}/${id}`,
      values,
      {
        requestKey: getEntityRequestKey('edit', entityType, id),
        isInterruptive: opts.isInterruptive ?? true,
        feedback: {
          loading: `Updating ${entityConfig[entityType].displayName}`,
          success: `${entityConfig[entityType].displayName} updated`,
          ...(opts.feedback || {}),
        },
      },
    );
  };

  const deleteEntity = <T extends Entity>(
    entityType: T,
    id: string,
    opts: CommonOptions = {},
  ) => {
    const { entityApiBaseUrl = ENTITY_API_BASE_URL } = options;
    const entityConfig = monoriseStore.getState().config;
    return axios.delete(
      opts.customUrl || `${entityApiBaseUrl}/${entityType}/${id}`,
      {
        requestKey: getEntityRequestKey('delete', entityType, id),
        isInterruptive: opts.isInterruptive ?? true,
        feedback: {
          loading: `Deleting ${entityConfig[entityType].displayName}`,
          success: `${entityConfig[entityType].displayName} deleted`,
          ...(opts.feedback || {}),
        },
      },
    );
  };

  const listEntitiesByEntity = <B extends Entity, T extends Entity>(
    byEntityType: B,
    entityType: T,
    byEntityId: string,
    opts: CommonOptions = {},
    chainEntityQuery?: string,
  ) => {
    const { mutualApiBaseUrl = MUTUAL_API_BASE_URL } = options;
    return axios.get<{ entities: Mutual<B, T>[]; lastKey: string }>(
      opts.customUrl ||
        `${mutualApiBaseUrl}/${byEntityType}/${byEntityId}/${entityType}`,
      {
        requestKey: getMutualRequestKey(
          'list',
          byEntityType,
          entityType,
          byEntityId,
          undefined,
          chainEntityQuery,
        ),
        isInterruptive: opts.isInterruptive,
        feedback: opts.feedback,
        params: {
          chainEntityQuery,
          ...opts.params,
          ...(opts.noData && { projection: 'no-data' }),
        },
      },
    );
  };

  const getMutual = <B extends Entity, T extends Entity>(
    byEntityType: B,
    entityType: T,
    byEntityId: string,
    entityId: string,
    opts: CommonOptions = {},
  ) => {
    const { mutualApiBaseUrl = MUTUAL_API_BASE_URL } = options;
    return axios.get<Mutual<B, T>>(
      opts.customUrl ||
        `${mutualApiBaseUrl}/${getMutualStateKey(byEntityType, byEntityId, entityType, entityId)}`,
      {
        requestKey: getMutualRequestKey(
          'get',
          byEntityType,
          entityType,
          byEntityId,
          entityId,
        ),
        isInterruptive: opts.isInterruptive ?? false,
        feedback: opts.feedback,
      },
    );
  };

  const createMutual = <B extends Entity, T extends Entity>(
    byEntityType: B,
    entityType: T,
    byEntityId: string,
    entityId: string,
    payload: MutualData<B, T> | Record<string, unknown>,
    opts: CommonOptions = {},
  ) => {
    const { mutualApiBaseUrl = MUTUAL_API_BASE_URL } = options;
    return axios.post<Mutual<B, T>>(
      opts.customUrl ||
        `${mutualApiBaseUrl}/${getMutualStateKey(byEntityType, byEntityId, entityType, entityId)}`,
      payload,
      {
        requestKey: getMutualRequestKey(
          'create',
          byEntityType,
          entityType,
          byEntityId,
        ),
        isInterruptive: opts.isInterruptive ?? true,
        feedback: {
          loading: 'Creating linkage',
          success: 'Linkage created',
          ...(opts.feedback || {}),
        },
      },
    );
  };

  const editMutual = <B extends Entity, T extends Entity>(
    byEntityType: B,
    entityType: T,
    byEntityId: string,
    entityId: string,
    payload: MutualData<B, T> | Record<string, unknown>,
    opts: CommonOptions = {},
  ) => {
    const { mutualApiBaseUrl = MUTUAL_API_BASE_URL } = options;
    return axios.patch<Mutual<B, T>>(
      opts.customUrl ||
        `${mutualApiBaseUrl}/${getMutualStateKey(byEntityType, byEntityId, entityType, entityId)}`,
      payload,
      {
        requestKey: getMutualRequestKey(
          'update',
          byEntityType,
          entityType,
          byEntityId,
          entityId,
        ),
        isInterruptive: opts.isInterruptive ?? true,
        feedback: {
          loading: 'Updating linkage',
          success: 'Linkage updated',
          ...(opts.feedback || {}),
        },
      },
    );
  };

  const deleteMutual = <B extends Entity, T extends Entity>(
    byEntityType: B,
    entityType: T,
    byEntityId: string,
    entityId: string,
    opts: CommonOptions = {},
  ) => {
    const { mutualApiBaseUrl = MUTUAL_API_BASE_URL } = options;
    return axios.delete(
      opts.customUrl ||
        `${mutualApiBaseUrl}/${getMutualStateKey(byEntityType, byEntityId, entityType, entityId)}`,
      {
        requestKey: getMutualRequestKey(
          'delete',
          byEntityType,
          entityType,
          byEntityId,
          entityId,
        ),
        isInterruptive: opts.isInterruptive ?? true,
        feedback: {
          loading: 'Removing linkage',
          success: 'Linkage removed',
          ...(opts.feedback || {}),
        },
      },
    );
  };

  const makeEntityService = <T extends Entity>(entityType: T) => ({
    listEntities: (payload: ListEntitiesPayload, opts: CommonOptions = {}) =>
      listEntities(entityType, payload, opts),
    searchEntities: (query: string, opts: CommonOptions = {}) =>
      searchEntities(entityType, query, opts),
    listEntitiesByTag: (tagName: string, opts: CommonOptions = {}) =>
      listEntitiesByTag(entityType, tagName, opts),
    getEntity: (id: string, opts: CommonOptions = {}) =>
      getEntity(entityType, id, opts),
    getEntityByUniqueField: (
      fieldName: string,
      value: string,
      opts: CommonOptions = {},
    ) => getEntityByUniqueField(entityType, fieldName, value, opts),
    createEntity: (values: DraftEntity<T>, opts: CommonOptions = {}) =>
      createEntity(entityType, values, opts),
    upsertEntity: (
      id: string,
      values: DraftEntity<T>,
      opts: CommonOptions = {},
    ) => upsertEntity(entityType, id, values, opts),
    editEntity: (
      id: string,
      values: Partial<DraftEntity<T>>,
      opts: CommonOptions = {},
    ) => editEntity(entityType, id, values, opts),
    updateEntity: (
      id: string,
      values: DraftEntity<T>,
      opts: CommonOptions = {},
    ) => editEntity(entityType, id, values, opts),
    deleteEntity: (id: string, opts: CommonOptions = {}) =>
      deleteEntity(entityType, id, opts),
  });

  const makeMutualService = <B extends Entity, T extends Entity>(
    byEntityType: B,
    entityType: T,
  ) => ({
    listEntitiesByEntity: (
      byEntityId: string,
      opts: CommonOptions = {},
      chainEntityQuery?: string,
    ) =>
      listEntitiesByEntity(
        byEntityType,
        entityType,
        byEntityId,
        opts,
        chainEntityQuery,
      ),
    getMutual: (
      byEntityId: string,
      entityId: string,
      opts: CommonOptions = {},
    ) => getMutual(byEntityType, entityType, byEntityId, entityId, opts),
    createMutual: (
      byEntityId: string,
      entityId: string,
      payload: MutualData<B, T> | Record<string, unknown>,
      opts = {},
    ) =>
      createMutual(
        byEntityType,
        entityType,
        byEntityId,
        entityId,
        payload,
        opts,
      ),
    editMutual: (
      byEntityId: string,
      entityId: string,
      payload: MutualData<B, T> | Record<string, unknown>,
      opts = {},
    ) =>
      editMutual(byEntityType, entityType, byEntityId, entityId, payload, opts),
    deleteMutual: (
      byEntityId: string,
      entityId: string,
      opts: CommonOptions = {},
    ) => deleteMutual(byEntityType, entityType, byEntityId, entityId, opts),
  });

  const setOptions = (opts: ConfigOptions) => {
    options = {
      ...options,
      ...opts,
    };
  };

  return {
    makeEntityService,
    makeMutualService,
    setOptions,
  };
};

export default initCoreService;

export type CoreService = ReturnType<typeof initCoreService>;
