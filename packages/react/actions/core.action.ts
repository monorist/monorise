import type {
  CreatedEntity,
  DraftEntity,
  Entity,
  EntitySchemaMap,
} from '@monorise/base';
import { produce } from 'immer';
import { useEffect, useState } from 'react';
import {
  byEntityId,
  constructLocal,
  constructMutual,
  flipMutual,
} from '../lib/entity';
import {
  convertToMap,
  getMutualStateKey,
  getTagStateKey,
  getUniqueFieldStateKey,
} from '../lib/utils';
import type {
  CommonOptions,
  CoreService,
  ListEntitiesByTagParams,
} from '../services/core.service';
import type { MonoriseStore } from '../store/monorise.store';
import type { ApplicationRequestError } from '../types/api.type';
import type { CommonStore } from '../types/monorise.type';
import type { Mutual, MutualData } from '../types/mutual.type';
import type { AppActions } from './app.action';

// ===== Important tips ======
// Should we use store.getState() or store()?
// USE store.getState() WHEN using within an action such as getEntity, getProfile
// USE store() WHEN using within a react hook so that it gets the benefit of reactivity, such as useProfile, useEntity

const initCoreActions = (
  monoriseStore: MonoriseStore,
  appActions: AppActions,
  coreService: CoreService,
) => {
  const { makeEntityService, makeMutualService } = coreService;
  const { checkIsLoading, getError, useLoadStore, useErrorStore } = appActions;

  const listEntities = async <T extends Entity>(
    entityType: T,
    params: {
      skRange?: { start: string; end: string };
      all?: boolean;
    } = {},
    opts: CommonOptions = {},
  ) => {
    const store = monoriseStore.getState();
    const entityState = store.entity[entityType] ?? {};
    const { isFirstFetched } = entityState;
    const entityService = makeEntityService(entityType);
    const { skRange } = params;
    const requestKey = `entity/${entityType}/list`;
    const isLoading = checkIsLoading(requestKey);
    const error = getError(requestKey);

    if ((isFirstFetched && !params.skRange) || isLoading || error) {
      return;
    }

    const { data: result } = await entityService.listEntities(
      {
        ...(params?.all ? {} : { limit: 20 }),
        start: skRange?.start,
        end: skRange?.end,
      },
      opts,
    );
    const newEntityMap = convertToMap<CreatedEntity<T>>(
      result.data,
      'entityId',
    );

    const mergedMap = new Map([
      ...newEntityMap,
      ...store.entity[entityType].dataMap,
    ]);

    monoriseStore.setState(
      produce((state) => {
        state.entity[entityType] = {
          dataMap: params.skRange ? newEntityMap : mergedMap,
          isFirstFetched: true,
          lastKey: result.lastKey,
        };
      }),
      undefined,
      `mr/entity/list/${entityType}`,
    );
  };

  const listMoreEntities = async <T extends Entity>(
    entityType: T,
    opts: CommonOptions = {},
  ) => {
    const store = monoriseStore.getState();
    const entityState = store.entity[entityType];
    const { dataMap, lastKey } = entityState;
    const entityService = makeEntityService(entityType);

    if (!lastKey) {
      return;
    }

    const { data: result } = await entityService.listEntities(
      {
        limit: 20,
        lastKey,
      },
      opts,
    );

    monoriseStore.setState(
      produce((state) => {
        state.entity[entityType].isFirstFetched = true;
        state.entity[entityType].lastKey = result.lastKey;
        for (const i in result.data) {
          state.entity[entityType].dataMap.set(
            result.data[i].entityId,
            result.data[i],
          );
        }
      }),
      undefined,
      `mr/entity/list-more/${entityType}`,
    );
  };

  const searchEntities = async <T extends Entity>(
    entityType: T,
    query: string,
    opts: CommonOptions = {},
  ) => {
    const entityService = makeEntityService(entityType);
    const { data: result } = await entityService.searchEntities(query, opts);

    monoriseStore.setState(
      produce((state) => {
        state.entity[entityType].searchResults = result.data;
        for (const i in result.data) {
          state.entity[entityType].dataMap.set(
            result.data[i].entityId,
            result.data[i],
          );
        }
      }),
    );
  };

  const listEntitiesByTag = async <T extends Entity>(
    entityType: T,
    tagName: string,
    opts: CommonOptions & { params?: ListEntitiesByTagParams } = {},
  ) => {
    const tagKey = getTagStateKey(entityType, tagName, opts.params);

    const state = monoriseStore.getState();
    const tagState = state.tag[tagKey] || {};
    const { isFirstFetched, dataMap } = tagState;
    const entityService = makeEntityService(entityType);
    const { forceFetch } = opts;
    const requestKey = `tag/${tagKey}/list`;
    const isLoading = checkIsLoading(requestKey);
    const error = getError(requestKey);

    if (!forceFetch && (isFirstFetched || isLoading || error)) {
      return;
    }

    const { data } = await entityService.listEntitiesByTag(tagName, {
      ...opts,
      requestKey,
    });
    const { entities, lastKey } = data;

    monoriseStore.setState(
      produce((state) => {
        for (const entity of entities) {
          state.entity[entityType].dataMap.set(entity.entityId, entity);
        }
      }),
    );

    monoriseStore.setState(
      produce((state) => {
        state.tag[tagKey] = {
          dataMap: convertToMap(entities, 'entityId'),
          isFirstFetched: true,
          lastKey,
        };
      }),
    );

    return data;
  };
  const getEntity = async <T extends Entity>(
    entityType: T,
    id: string,
    opts: CommonOptions = {},
  ) => {
    const store = monoriseStore.getState();
    const entityState = store.entity[entityType];
    const { dataMap } = entityState;
    const entityService = makeEntityService(entityType);
    let entity = dataMap.get(id);
    const requestKey = `entity/${entityType}/get/${id}`;
    const isLoading = checkIsLoading(requestKey);
    const error = getError(requestKey);
    const { forceFetch } = opts;

    if (!forceFetch && (entity || isLoading || error)) {
      return entity;
    }

    ({ data: entity } = await entityService.getEntity(id, opts));

    monoriseStore.setState(
      produce((state) => {
        state.entity[entityType].dataMap.set(entity?.entityId, entity);
      }),
      undefined,
      `mr/entity/get/${entityType}/${id}`,
    );

    return entity;
  };

  const getEntityByUniqueField = async <T extends Entity>(
    entityType: T,
    fieldName: string,
    value: string,
    opts: CommonOptions = {},
  ) => {
    const store = monoriseStore.getState();
    const entityState = store.entity[entityType];
    const { dataMap } = entityState;
    const entityService = makeEntityService(entityType);
    const stateKey = getUniqueFieldStateKey(fieldName, value);
    let entity = dataMap.get(stateKey);
    const requestKey = `entity/${entityType}/unique/${stateKey}`;
    const isLoading = checkIsLoading(requestKey);
    const error = getError(requestKey);
    const { forceFetch } = opts;

    if (!forceFetch && (entity || isLoading || error)) {
      return entity;
    }

    ({ data: entity } = await entityService.getEntityByUniqueField(
      fieldName,
      value,
      opts,
    ));

    monoriseStore.setState(
      produce((state) => {
        state.entity[entityType].dataMap.set(entity?.entityId, entity);
        state.entity[entityType].dataMap.set(`${stateKey}`, entity);
      }),
      undefined,
      `mr/entity/unique/${entityType}/${stateKey}`,
    );

    return entity;
  };

  const createEntity = async <T extends Entity>(
    entityType: T,
    entity: DraftEntity<T>,
    opts: CommonOptions = {},
  ) => {
    const entityService = makeEntityService(entityType);
    const { data } = await entityService.createEntity(entity, opts);

    monoriseStore.setState(
      produce((state) => {
        state.entity[entityType].dataMap.set(data.entityId, data);
      }),
      undefined,
      `mr/entity/create/${entityType}`,
    );

    return data;
  };

  const upsertEntity = async <T extends Entity>(
    entityType: T,
    id: string,
    entity: DraftEntity<T>,
    opts: CommonOptions = {},
  ) => {
    const entityService = makeEntityService(entityType);
    const { data } = await entityService.upsertEntity(id, entity, opts);

    monoriseStore.setState(
      produce((state) => {
        state.entity[entityType].dataMap.set(data.entityId, data);
      }),
      undefined,
      `mr/entity/upsert/${entityType}/${id}`,
    );
  };

  const editEntity = async <T extends Entity>(
    entityType: T,
    id: string,
    entity: Partial<DraftEntity<T>>,
    opts: CommonOptions = {},
  ) => {
    const entityService = makeEntityService(entityType);
    const { data } = await entityService.editEntity(id, entity, opts);

    monoriseStore.setState(
      produce((state) => {
        state.entity[entityType].dataMap.set(data.entityId, data);

        // update mutual's entity data
        for (const key of Object.keys(state.mutual)) {
          const [_byEntity, _byId, _entityType] = key.split('/');
          if ((_entityType as unknown as Entity) === entityType) {
            const mutual = state.mutual[key].dataMap.get(id);
            state.mutual[key].dataMap = new Map(state.mutual[key].dataMap).set(
              id,
              { ...mutual, data: data.data },
            );
          }
        }
      }),
      undefined,
      `mr/entity/edit/${entityType}/${id}`,
    );
  };

  const deleteEntity = async <T extends Entity>(
    entityType: T,
    id: string,
    opts: CommonOptions = {},
  ) => {
    const entityService = makeEntityService(entityType);
    await entityService.deleteEntity(id, opts);
    deleteLocalMutualsByEntity(entityType, id);

    monoriseStore.setState(
      produce((state) => {
        state.entity[entityType].dataMap.delete(id);
      }),
      undefined,
      `mr/entity/delete/${entityType}/${id}`,
    );
  };

  const listEntitiesByEntity = async <B extends Entity, T extends Entity>(
    byEntityType: B,
    entityType: T,
    id: string,
    opts: CommonOptions = {},
    chainEntityQuery?: string,
  ) => {
    const selfKey =
      opts.stateKey ??
      getMutualStateKey(
        byEntityType,
        id,
        entityType,
        undefined,
        chainEntityQuery,
      );
    const mutualService = makeMutualService(byEntityType, entityType);
    const store = monoriseStore.getState();
    const mutualState = store.mutual[selfKey] || {};
    const { isFirstFetched } = mutualState;
    const requestKey = `mutual/${selfKey}/list`;
    const isLoading = checkIsLoading(requestKey);
    const error = getError(requestKey);
    const { forceFetch } = opts;

    if (!forceFetch && (isFirstFetched || isLoading || error)) {
      return;
    }

    const { data } = await mutualService.listEntitiesByEntity(
      id,
      opts,
      chainEntityQuery,
    );
    const { entities, lastKey } = data;

    const newEntityDataMap = new Map();

    for (const i in entities) {
      newEntityDataMap.set(entities[i].entityId, entities[i]);
    }

    monoriseStore.setState(
      produce((state) => {
        for (const [key, value] of newEntityDataMap) {
          state.entity[entityType]?.dataMap.set(key, value);
        }

        state.mutual[selfKey] = {
          dataMap: convertToMap(entities, 'entityId'),
          isFirstFetched: true,
          lastKey,
        };
      }),
      undefined,
      `mr/mutual/list/${selfKey}`,
    );
  };

  // todo: list more mutuals by entity
  // const listMoremutualsByEntity = async (
  //   entityType: Entity,
  //   otherEntityType: Entity,
  //   id: string,
  // ) =>

  const getMutual = async <B extends Entity, T extends Entity>(
    byEntityType: B,
    entityType: T,
    byEntityId: string | null,
    entityId: string,
    opts: CommonOptions & {
      // if failed to retrieve, would still set a default mutual data
      defaultMutualData?: Record<string, any>;
    } = {},
  ) => {
    const selfKey = getMutualStateKey(byEntityType, byEntityId, entityType);
    const mutualService = makeMutualService(byEntityType, entityType);
    const store = monoriseStore.getState();
    const mutualState = store.mutual[selfKey] || {};
    const requestKey = `mutual/${getMutualStateKey(
      byEntityType,
      byEntityId,
      entityType,
      entityId,
    )}/get`;
    const isLoading = checkIsLoading(requestKey);
    const error = getError(requestKey);

    if (!byEntityId || isLoading || error) {
      return;
    }

    if (mutualState.dataMap?.get(entityId)) {
      return mutualState.dataMap.get(entityId) as Mutual<B, T>;
    }

    let mutual: Omit<Mutual<B, T>, 'data'>;
    let hasRequestFailed = false;

    try {
      ({ data: mutual } = await mutualService.getMutual(
        byEntityId,
        entityId,
        opts,
      ));
    } catch (err) {
      if (!opts.defaultMutualData) {
        throw err;
      }

      hasRequestFailed = true;
      mutual = {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        mutualId: `${byEntityId}-${entityId}`,
        mutualUpdatedAt: new Date().toISOString(),
        byEntityType,
        byEntityId,
        entityType,
        entityId,
        mutualData: opts.defaultMutualData,
      };
    }

    const newMutualDataMap = new Map(store.mutual[selfKey]?.dataMap);
    newMutualDataMap.set(mutual.entityId, mutual as Mutual<B, T>);

    if (!hasRequestFailed) {
      const entityState = store.entity[entityType];
      const { dataMap: entityDataMap } = entityState;

      const newEntityDataMap = new Map(entityDataMap);
      newEntityDataMap.set(mutual.entityId, mutual as any);

      monoriseStore.setState(
        produce((state) => {
          state.mutual[selfKey] = {
            ...(state.mutual[selfKey] || {}),
            dataMap: newMutualDataMap,
          };
          state.entity[entityType].dataMap = newEntityDataMap;
        }),
        undefined,
        `mr/mutual/get/${getMutualStateKey(
          byEntityType,
          byEntityId,
          entityType,
          entityId,
        )}`,
      );
    }
  };

  const createMutual = async <B extends Entity, T extends Entity>(
    byEntityType: B,
    entityType: T,
    byEntityId: string,
    entityId: string,
    payload: MutualData<B, T> | Record<string, any> = {},
    opts: CommonOptions = {},
  ) => {
    const mutualService = makeMutualService(byEntityType, entityType);
    const { data: mutual } = await mutualService.createMutual(
      byEntityId,
      entityId,
      payload,
      opts,
    );

    monoriseStore.setState(
      produce((state) => {
        const bySide = getMutualStateKey(byEntityType, byEntityId, entityType);
        const side = getMutualStateKey(entityType, entityId, byEntityType);

        if (!state.mutual[bySide]) {
          state.mutual[bySide] = {
            dataMap: new Map(),
          };
        }

        state.mutual[bySide].dataMap = new Map(
          state.mutual[bySide]?.dataMap,
        ).set(mutual.entityId, mutual);

        if (!state.mutual[side]) {
          state.mutual[side] = {
            dataMap: new Map(),
          };
        }

        state.mutual[side].dataMap = new Map(state.mutual[side]?.dataMap).set(
          mutual.byEntityId,
          flipMutual(mutual),
        );
      }),
      undefined,
      `mr/mutual/create/${getMutualStateKey(byEntityType, byEntityId, entityType, entityId)}`,
    );
  };

  const createLocalMutual = async <B extends Entity, T extends Entity>(
    byEntityType: B,
    entityType: T,
    byEntityId: string,
    entityId: string,
    mutualData: MutualData<B, T>,
    data: EntitySchemaMap[T] | Record<string, any>,
  ) => {
    const mutual = constructMutual(
      byEntityType,
      byEntityId,
      entityType,
      entityId,
      mutualData,
      data as EntitySchemaMap[T],
    );

    monoriseStore.setState(
      produce((state) => {
        const bySide = getMutualStateKey(byEntityType, byEntityId, entityType);
        const side = getMutualStateKey(entityType, entityId, byEntityType);

        if (!state.mutual[bySide]) {
          state.mutual[bySide] = {
            dataMap: new Map(),
          };
        }

        state.mutual[bySide].dataMap = new Map(
          state.mutual[bySide]?.dataMap,
        ).set(mutual.entityId, mutual);

        if (!state.mutual[side]) {
          state.mutual[side] = {
            dataMap: new Map(),
          };
        }

        state.mutual[side].dataMap = new Map(state.mutual[side]?.dataMap).set(
          mutual.byEntityId,
          flipMutual(mutual),
        );
      }),
      undefined,
      `mr/mutual/create/${getMutualStateKey(byEntityType, byEntityId, entityType, entityId)}`,
    );
  };

  const updateLocalEntity = async <T extends Entity>(
    entityType: Entity,
    entityId: string,
    data: Partial<DraftEntity<T>> = {},
  ) => {
    const createdEntity = constructLocal(entityType, entityId, data);

    monoriseStore.setState(
      produce((state) => {
        state.entity[entityType].dataMap.set(entityId, createdEntity);
      }),
      undefined,
      `mr/entity/local-update/${entityType}/${entityId}`,
    );
  };

  const upsertLocalMutual = async <B extends Entity, T extends Entity>(
    byEntityType: B,
    entityType: T,
    byEntityId: string,
    entityId: string,
    mutualData: MutualData<B, T>,
    data: EntitySchemaMap[T] | Record<string, any> = {},
  ) => {
    const mutual = constructMutual(
      byEntityType,
      byEntityId,
      entityType,
      entityId,
      mutualData,
      data as EntitySchemaMap[T],
    );

    monoriseStore.setState(
      produce((state) => {
        const bySide = getMutualStateKey(byEntityType, byEntityId, entityType);
        const side = getMutualStateKey(entityType, entityId, byEntityType);

        if (!state.mutual[bySide]) {
          state.mutual[bySide] = {
            dataMap: new Map(),
          };
        }

        state.mutual[bySide].dataMap = new Map(
          state.mutual[bySide]?.dataMap,
        ).set(entityId, mutual);

        if (!state.mutual[side]) {
          state.mutual[side] = {
            dataMap: new Map(),
          };
        }

        state.mutual[side].dataMap = new Map(state.mutual[side]?.dataMap).set(
          byEntityId,
          flipMutual(mutual),
        );
      }),
      undefined,
      `mr/mutual/local-update/${getMutualStateKey(byEntityType, byEntityId, entityType, entityId)}`,
    );
  };

  const editMutual = async <B extends Entity, T extends Entity>(
    byEntityType: B,
    entityType: T,
    byEntityId: string,
    entityId: string,
    payload: MutualData<B, T> | Record<string, any> = {},
    opts: CommonOptions = {},
  ) => {
    const mutualService = makeMutualService(byEntityType, entityType);
    const { data: mutual } = await mutualService.editMutual(
      byEntityId,
      entityId,
      payload,
      opts,
    );

    monoriseStore.setState(
      produce((state) => {
        const bySide = getMutualStateKey(byEntityType, byEntityId, entityType);
        const side = getMutualStateKey(entityType, entityId, byEntityType);

        if (!state.mutual[bySide]) {
          state.mutual[bySide] = {
            dataMap: new Map(),
          };
        }

        state.mutual[bySide].dataMap = new Map(
          state.mutual[bySide]?.dataMap,
        ).set(mutual.entityId, mutual);

        if (!state.mutual[side]) {
          state.mutual[side] = {
            dataMap: new Map(),
          };
        }

        state.mutual[side].dataMap = new Map(state.mutual[side]?.dataMap).set(
          mutual.byEntityId,
          flipMutual(mutual),
        );
      }),
      undefined,
      `mr/mutual/edit/${getMutualStateKey(byEntityType, byEntityId, entityType, entityId)}`,
    );
  };

  const deleteMutual = async <B extends Entity, T extends Entity>(
    byEntityType: B,
    entityType: T,
    byEntityId: string,
    entityId = '',
    opts: CommonOptions = {},
  ) => {
    const mutualService = makeMutualService(byEntityType, entityType);
    const { data } = await mutualService.deleteMutual(
      byEntityId,
      entityId,
      opts,
    );

    monoriseStore.setState(
      produce((state) => {
        const bySide = getMutualStateKey(byEntityType, byEntityId, entityType);
        const side = getMutualStateKey(entityType, entityId, byEntityType);

        state.mutual[bySide].dataMap.delete(data.entityId);

        if (state.mutual[side]) {
          state.mutual[side].dataMap.delete(data.byEntityId);
        }
      }),
      undefined,
      `mr/mutual/delete/${getMutualStateKey(byEntityType, byEntityId, entityType, entityId)}`,
    );
  };

  const deleteLocalMutual = <B extends Entity, T extends Entity>(
    byEntityType: B,
    entityType: T,
    byEntityId: string,
    entityId: string,
  ) => {
    monoriseStore.setState(
      produce((state) => {
        const bySide = getMutualStateKey(byEntityType, byEntityId, entityType);
        const side = getMutualStateKey(entityType, entityId, byEntityType);
        const bySideDataMap = new Map(state[bySide]?.dataMap);
        const sideDataMap = new Map(state[side]?.dataMap);
        bySideDataMap.delete(entityId);
        sideDataMap.delete(byEntityId);

        state.mutual[bySide].dataMap.delete(entityId);
        state.mutual[side].dataMap.delete(byEntityId);
      }),
      undefined,
      `mr/mutual/local-delete/${getMutualStateKey(byEntityType, byEntityId, entityType, entityId)}`,
    );
  };

  const deleteLocalMutualsByEntity = <T extends Entity>(
    entityType: T,
    id: string,
  ) => {
    const store = monoriseStore.getState();
    const entityConfig = store.config;
    let mutuals: Mutual[] = [];
    for (const i of Object.keys(entityConfig)) {
      const mutualState = store.mutual[`${entityType}/${id}/${i}`];
      mutuals = [
        ...mutuals,
        ...Array.from(mutualState?.dataMap.values() || []),
      ];
    }

    const updatedState = mutuals.reduce(
      (acc, mutual) => {
        const side = getMutualStateKey(
          mutual.entityType,
          mutual.entityId,
          mutual.byEntityType,
        );
        const dataMap = new Map(store.mutual[side].dataMap);
        dataMap.delete(id);
        acc[side] = {
          ...store.mutual[side],
          dataMap,
        };
        return acc;
      },
      {} as Record<string, CommonStore<Mutual>>,
    );

    monoriseStore.setState(
      produce((state) => {
        state.mutual = updatedState;
      }),
      undefined,
      `mr/mutual/local-delete-by-entity/${entityType}/${id}`,
    );
  };

  const useEntity = <T extends Entity>(
    entityType: T,
    id?: string,
    opts: CommonOptions = {},
  ): {
    entity: CreatedEntity<T> | undefined;
    isLoading: boolean;
    error?: ApplicationRequestError;
    requestKey: string;
    isFirstFetched?: boolean;
    refetch: () => Promise<CreatedEntity<T> | undefined>;
  } => {
    const dataMap = monoriseStore(
      (state) => state.entity[entityType]?.dataMap || new Map(),
    );
    const isFirstFetched = monoriseStore(
      (state) => state.entity[entityType]?.isFirstFetched,
    );
    const requestKey = `entity/${entityType}/get/${id}`;
    const isLoading = useLoadStore(requestKey);
    const error = useErrorStore(requestKey);

    useEffect(() => {
      if (id) {
        getEntity(entityType, id, opts);
      }
    }, [id, entityType, opts]);

    return {
      entity: id ? dataMap.get(id) : undefined,
      isLoading,
      error,
      requestKey,
      isFirstFetched,
      refetch: async () => {
        if (id) {
          return await getEntity(entityType, id, { ...opts, forceFetch: true });
        }
      },
    };
  };

  const useEntityByUniqueField = <T extends Entity>(
    entityType: T,
    fieldName: string,
    value?: string,
    opts: CommonOptions = {},
  ): {
    entity: CreatedEntity<T> | undefined;
    isLoading: boolean;
    error?: ApplicationRequestError;
    requestKey: string;
    isFirstFetched?: boolean;
    refetch: () => Promise<CreatedEntity<T> | undefined>;
  } => {
    const dataMap = monoriseStore(
      (state) => state.entity[entityType]?.dataMap || new Map(),
    );
    const isFirstFetched = monoriseStore(
      (state) => state.entity[entityType]?.isFirstFetched,
    );
    const stateKey = getUniqueFieldStateKey(fieldName, value || '');
    const requestKey = `entity/${entityType}/unique/${stateKey}`;
    const isLoading = useLoadStore(requestKey);
    const error = useErrorStore(requestKey);

    useEffect(() => {
      if (value) {
        getEntityByUniqueField(entityType, fieldName, value, opts);
      }
    }, [fieldName, value, entityType, opts]);

    return {
      entity: value ? dataMap.get(`${stateKey}`) : undefined,
      isLoading,
      error,
      requestKey,
      isFirstFetched,
      refetch: async () => {
        if (value) {
          return await getEntityByUniqueField(entityType, fieldName, value, {
            ...opts,
            forceFetch: true,
          });
        }
      },
    };
  };

  const useEntities = <T extends Entity>(
    entityType: T,
    params: {
      skRange?: {
        start: string;
        end: string;
      };
      all?: boolean;
    } = {},
    opts: CommonOptions = {},
  ): {
    isLoading: boolean;
    entities?: CreatedEntity<T>[];
    entitiesMap: Map<string, CreatedEntity<T>>;
    error?: ApplicationRequestError;
    requestKey: string;
    searchField: {
      value: string;
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
    };
    lastKey?: string;
    isFirstFetched?: boolean;
  } => {
    const requestKey = `entity/${entityType}/list`;
    const isListing = useLoadStore(requestKey);
    const error = useErrorStore(requestKey);
    const state = monoriseStore((state) => state.entity[entityType]);
    const { dataMap, searchResults, isFirstFetched, lastKey } = state ?? {
      dataMap: new Map(),
    };
    const [entities, setEntities] = useState<CreatedEntity<T>[]>();
    const [query, setQuery] = useState<string>('');
    const [skRange, setBetween] = useState(params.skRange);
    const [all, setAll] = useState(params.all);
    const [isSearching, setIsSearching] = useState(false);
    const isLoading = isListing || isSearching;

    useEffect(() => {
      if (
        params?.skRange &&
        skRange?.start !== params.skRange.start &&
        skRange?.end !== params.skRange.end
      ) {
        setBetween(params.skRange);
      }
    }, [skRange?.end, skRange?.start, params.skRange]);

    useEffect(() => {
      if (params?.all !== all) {
        setAll(params.all);
      }
    }, [all, params.all]);

    useEffect(() => {
      if (!isFirstFetched) {
        listEntities(entityType, { skRange, all }, opts);
      }
    }, [all, entityType, skRange, opts, isFirstFetched]);

    useEffect(() => {
      let queryTimeout: NodeJS.Timeout;

      if (query?.length) {
        setIsSearching(true);
        queryTimeout = setTimeout(async () => {
          await searchEntities(entityType, query);
          setIsSearching(false);
        }, 700);
      }

      return () => queryTimeout && clearTimeout(queryTimeout);
    }, [entityType, query]);

    useEffect(() => {
      if (!query && dataMap.size !== entities?.length) {
        setIsSearching(false);
        setEntities(
          Array.from(dataMap.values()).sort(byEntityId) as CreatedEntity<T>[],
        );
      }

      if (query) {
        setEntities(searchResults as CreatedEntity<T>[]);
      }
    }, [
      dataMap,
      dataMap.size,
      entities?.length,
      query,
      searchResults,
      searchResults?.length,
    ]);

    const handleQueryChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      setQuery(event.target.value);
    };

    const searchField = {
      value: query,
      onChange: handleQueryChange,
    };

    return {
      entities,
      entitiesMap: dataMap,
      searchField,
      isLoading,
      error,
      requestKey,
      isFirstFetched,
      lastKey,
    };
  };

  const useMutual = <B extends Entity, T extends Entity>(
    byEntityType: B,
    entityType: T,
    byId: string | null,
    id: string,
    opts: CommonOptions & {
      // if failed to retrieve, would still set a default mutual data
      defaultMutualData?: Record<string, any>;
    } = {},
  ): {
    mutual?: Mutual<B, T>;
    isLoading: boolean;
    error?: ApplicationRequestError;
    requestKey: string;
  } => {
    const stateKey = getMutualStateKey(byEntityType, byId, entityType);
    const state = monoriseStore((state) => state.mutual[stateKey]);
    const requestKey = `mutual/${getMutualStateKey(byEntityType, byId, entityType, id)}/get`;
    const isLoading = useLoadStore(requestKey);
    const error = useErrorStore(requestKey);

    const { dataMap } = state || {
      dataMap: new Map(),
    };

    useEffect(() => {
      if (!dataMap.get(id)) {
        getMutual(byEntityType, entityType, byId, id, opts);
      }
    }, [byEntityType, byId, entityType, id, opts, dataMap]);

    return {
      mutual: dataMap.get(id) as Mutual<B, T>,
      isLoading,
      error,
      requestKey,
    };
  };

  const useMutuals = <B extends Entity, T extends Entity>(
    byEntityType: B,
    entityType: T,
    byId?: string,
    opts: CommonOptions = {},
    chainEntityQuery?: string, // chain entity query, refer to list-entities-by-entity.controller.ts
  ): {
    mutuals: Mutual<B, T>[];
    mutualsMap: Map<string, Mutual<B, T>>;
    isLoading: boolean;
    requestKey: string;
    error?: ApplicationRequestError;
    isFirstFetched?: boolean;
    lastKey?: string;
    listMore: () => void;
  } => {
    const stateKey = getMutualStateKey(
      byEntityType,
      byId || '',
      entityType,
      undefined,
      chainEntityQuery,
    );
    const state = monoriseStore((state) => state.mutual[stateKey]);
    const { dataMap, isFirstFetched, lastKey } = state || {
      dataMap: new Map(),
    };
    const [mutuals, setMutuals] = useState<Mutual<B, T>[]>([]);
    const requestKey = `mutual/${stateKey}`;
    const isLoading = useLoadStore(requestKey);
    const error = useErrorStore(requestKey);

    useEffect(() => {
      if (!isFirstFetched && byEntityType && entityType && byId) {
        listEntitiesByEntity(
          byEntityType,
          entityType,
          byId,
          { ...opts, stateKey },
          chainEntityQuery,
        );
      }
    }, [
      isFirstFetched,
      byEntityType,
      byId,
      entityType,
      opts,
      chainEntityQuery,
      stateKey,
      opts?.forceFetch,
      opts?.noData,
    ]);

    useEffect(() => {
      const dataMapArray = Array.from(dataMap.values());
      if (
        dataMap.size !== mutuals?.length ||
        dataMapArray.some(
          (item, index) =>
            JSON.stringify(item) !== JSON.stringify(mutuals[index]),
        )
      ) {
        setMutuals(Array.from(dataMap.values()) as Mutual<B, T>[]);
      }
    }, [dataMap, dataMap.size, mutuals?.length]);

    return {
      mutuals,
      mutualsMap: dataMap as Map<string, Mutual<B, T>>,
      isLoading,
      requestKey,
      error,
      isFirstFetched,
      lastKey,
      listMore: () => {
        if (byEntityType && entityType && byId) {
          listEntitiesByEntity(
            byEntityType,
            entityType,
            byId,
            {
              ...opts,
              forceFetch: true,
              params: { ...opts.params, lastKey },
              stateKey,
            },
            chainEntityQuery,
          );
        }
      },
    };
  };

  const useTaggedEntities = <T extends Entity>(
    entityType: T,
    tagName: string,
    opts: CommonOptions & { params?: ListEntitiesByTagParams } = {},
  ) => {
    console.log('====useTaggedEntities');
    const { params } = opts || {};
    const stateKey = getTagStateKey(entityType, tagName, params?.group);
    const state = monoriseStore((state) => state.tag[stateKey]);
    const { dataMap, isFirstFetched, lastKey } = state || {
      dataMap: new Map(),
    };
    const [entities, setEntities] = useState<CreatedEntity<T>[]>([]);
    const requestKey = `tag/${stateKey}/list`;
    const isLoading = useLoadStore(requestKey);
    const error = useErrorStore(requestKey);

    useEffect(() => {
      console.log('===useEffect list');
      if (entityType && tagName && Object.keys(params).length > 0) {
        console.log('====listEntitiesByTag');
        listEntitiesByTag(entityType, tagName, opts);
      }
    }, [entityType, opts, tagName, params, opts?.forceFetch]);

    useEffect(() => {
      const dataMapArray = Array.from(dataMap.values());
      if (
        dataMap.size !== entities?.length ||
        dataMapArray.some(
          (item, index) =>
            JSON.stringify(item) !== JSON.stringify(entities[index]),
        )
      ) {
        setEntities(Array.from(dataMap.values()) as CreatedEntity<T>[]);
      }
    }, [dataMap, dataMap.size, entities?.length]);

    return {
      entities,
      entitiesMap: dataMap as Map<string, CreatedEntity<T>>,
      isLoading,
      requestKey,
      error,
      isFirstFetched,
      lastKey,
      refetch: async () => {
        if (entityType && tagName && params?.group) {
          return await listEntitiesByTag(entityType, tagName, {
            ...opts,
            forceFetch: true,
          });
        }
      },
      listMore: async () => {
        if (entityType && tagName && params?.group) {
          return await listEntitiesByTag(entityType, tagName, {
            ...opts,
            forceFetch: true,
            params: { ...params, lastKey },
          });
        }
      },
    };
  };

  const useEntityState = <T extends Entity>(entityType: T) => {
    return monoriseStore((state) => state.entity[entityType]);
  };

  return {
    listMoreEntities,
    createEntity,
    upsertEntity,
    editEntity,
    deleteEntity,
    getMutual,
    updateLocalEntity,
    createMutual,
    createLocalMutual,
    upsertLocalMutual,
    editMutual,
    deleteMutual,
    deleteLocalMutual,
    useEntity,
    useEntityByUniqueField,
    useEntities,
    useMutual,
    useMutuals,
    useTaggedEntities,
    useEntityState,
  };
};

export { initCoreActions };

export type CoreActions = ReturnType<typeof initCoreActions>;
