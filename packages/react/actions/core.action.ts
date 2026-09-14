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
  getEntityRequestKey,
  getMutualRequestKey,
  getMutualStateKey,
  getTagRequestKey,
  getTagStateKey,
  getUniqueFieldRequestKey,
  getUniqueFieldStateKey,
  parseMutualStateKey,
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
import {
  getTransactionCallRequestKey,
  getTransactionOperationRequestKey,
  type TransactionCreateEntity,
  type TransactionOperation,
} from '../helpers/transactional';

// ===== Important tips ======
// Should we use store.getState() or store()?
// USE store.getState() WHEN using within an action such as getEntity, getProfile
// USE store() WHEN using within a react hook so that it gets the benefit of reactivity, such as useProfile, useEntity

const defaultOnError = (error: ApplicationRequestError | Error) => {
  if (!(error instanceof Error) && error.status >= 500) {
    // we only want server error to be captured by error tracking service
    throw error;
  }
};

const initCoreActions = (
  monoriseStore: MonoriseStore,
  appActions: AppActions,
  coreService: CoreService,
) => {
  const { makeEntityService, makeMutualService } = coreService;
  const {
    checkIsLoading,
    getError,
    useLoadStore,
    useErrorStore,
    startLoading,
    endLoading,
    setError,
    clearError,
  } = appActions;

  const listEntities = async <T extends Entity>(
    entityType: T,
    params: {
      skRange?: { start: string; end: string };
      all?: boolean;
      limit?: number;
    } = { limit: 20 },
    opts: CommonOptions = {},
  ) => {
    const store = monoriseStore.getState();
    const entityState = store.entity[entityType] ?? {};
    const { isFirstFetched } = entityState;
    const entityService = makeEntityService(entityType);
    const { skRange } = params;
    const requestKey = getEntityRequestKey('list', entityType);
    const isLoading = checkIsLoading(requestKey);
    const error = getError(requestKey);
    const onError = opts.onError ?? defaultOnError;

    if (error) {
      onError(error);
      return;
    }

    if (
      !opts.forceFetch &&
      ((isFirstFetched && !params.skRange) || isLoading)
    ) {
      return;
    }

    try {
      const { data: result } = await entityService.listEntities(
        {
          ...(params?.all ? {} : { limit: params?.limit }),
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
    } catch (err) {
      const error: Error & { originalError?: unknown } =
        err instanceof Error ? err : new Error('Unknown error occurred');

      return { error };
    }
  };

  const listMoreEntities = async <T extends Entity>(
    entityType: T,
    opts: CommonOptions = {},
  ) => {
    const requestKey = getEntityRequestKey('list', entityType);
    const store = monoriseStore.getState();
    const entityState = store.entity[entityType];
    const { dataMap, lastKey } = entityState;
    const entityService = makeEntityService(entityType);
    const error = getError(requestKey);
    const onError = opts.onError ?? defaultOnError;

    if (!lastKey) {
      return;
    }

    if (error) {
      onError(error);
      return;
    }

    try {
      const { data: result } = await entityService.listEntities(
        {
          limit: opts.limit ?? 20,
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
    } catch (err) {
      const error: Error & { originalError?: unknown } =
        err instanceof Error ? err : new Error('Unknown error occurred');

      return { error };
    }
  };

  const searchEntities = async <T extends Entity>(
    entityType: T,
    query: string,
    opts: CommonOptions = {},
  ) => {
    const requestKey = getEntityRequestKey('search', entityType);
    const entityService = makeEntityService(entityType);
    const error = getError(requestKey);
    const onError = opts.onError ?? defaultOnError;

    if (error) {
      onError(error);
      return;
    }

    try {
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
    } catch (err) {
      const error: Error & { originalError?: unknown } =
        err instanceof Error ? err : new Error('Unknown error occurred');

      return { error };
    }
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
    const requestKey = getTagRequestKey(
      'list',
      entityType,
      tagName,
      opts.params,
    );
    const isLoading = checkIsLoading(requestKey);
    const error = getError(requestKey);
    const onError = opts.onError ?? defaultOnError;

    if (!forceFetch) {
      if (error) {
        onError(error);
        return { error };
      }

      if (isFirstFetched || isLoading) {
        return {
          data: {
            entities: Array.from(dataMap?.values() || []),
            lastKey: null,
          },
        };
      }
    }

    try {
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
          // Initialize tag state if it doesn't exist
          if (!state.tag[tagKey]) {
            state.tag[tagKey] = {
              dataMap: new Map(),
              isFirstFetched: false,
            };
          }

          // Merge new entities into existing dataMap instead of replacing
          for (const entity of entities) {
            state.tag[tagKey].dataMap.set(entity.entityId, entity);
          }

          state.tag[tagKey].isFirstFetched = true;
          state.tag[tagKey].lastKey = lastKey;
        }),
      );

      return { data };
    } catch (err) {
      const error: Error & { originalError?: unknown } =
        err instanceof Error ? err : new Error('Unknown error occurred');

      return { error };
    }
  };

  const getEntity = async <T extends Entity>(
    entityType: T,
    id: string,
    opts: CommonOptions = {},
  ): Promise<{
    data?: CreatedEntity<T>;
    error?: ApplicationRequestError | (Error & { originalError?: unknown });
  }> => {
    const store = monoriseStore.getState();
    const entityState = store.entity[entityType];
    const { dataMap } = entityState;
    const entityService = makeEntityService(entityType);
    let entity = dataMap.get(id);
    const requestKey = getEntityRequestKey('get', entityType, id);
    const isLoading = checkIsLoading(requestKey);
    const error = getError(requestKey);
    const { forceFetch } = opts;
    const onError = opts.onError ?? defaultOnError;

    if (!forceFetch) {
      if (error) {
        // If there's an existing error, handle it and return the error.
        onError?.(error);
        return { error };
      }

      if (entity) {
        // If entity already exists and no force fetch, return it.
        return { data: entity };
      }

      if (isLoading) {
        // If already loading, return undefined data and error to indicate ongoing operation.
        return {};
      }
    }

    try {
      ({ data: entity } = await entityService.getEntity(id, opts));

      monoriseStore.setState(
        produce((state) => {
          state.entity[entityType].dataMap.set(entity?.entityId, entity);
        }),
        undefined,
        `mr/entity/get/${entityType}/${id}`,
      );

      return { data: entity };
    } catch (err) {
      const error: Error & { originalError?: unknown } =
        err instanceof Error ? err : new Error('Unknown error occurred');

      return { error };
    }
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
    const requestKey = getUniqueFieldRequestKey(entityType, fieldName, value);
    const isLoading = checkIsLoading(requestKey);
    const error = getError(requestKey);
    const { forceFetch } = opts;
    const onError = opts.onError ?? defaultOnError;

    if (!forceFetch) {
      if (error) {
        onError?.(error);
        return { error };
      }

      if (entity) {
        return { data: entity };
      }

      if (isLoading) {
        return {};
      }
    }

    try {
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

      return { data: entity };
    } catch (err) {
      const error: Error & { originalError?: unknown } =
        err instanceof Error ? err : new Error('Unknown error occurred');

      return { error };
    }
  };

  // Populate already-loaded mutual-list caches for a freshly created entity —
  // e.g. so a `refund-line-item` created via `createEntity` or `executeTransaction`
  // immediately appears in an already-fetched
  // `useMutuals(Entity.REFUND, Entity.REFUND_LINE_ITEM, ...)` list, instead of
  // only showing up after that list's next refetch. `payload` is the raw
  // create payload (mutualFields' ids live there, not necessarily on the
  // server's returned `data.data`).
  const populateMutualsForCreatedEntity = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    state: any,
    entityType: Entity,
    data: CreatedEntity<Entity>,
    payload: Record<string, any>,
  ) => {
    const mutualFields = state.config[entityType]?.mutual?.mutualFields;
    if (!mutualFields) return;

    for (const [field, fieldConfig] of Object.entries(mutualFields)) {
      const byEntityType = (fieldConfig as any).entityType;
      const ids = payload[field];
      if (!Array.isArray(ids)) continue;

      for (const byEntityId of ids) {
        const mutualKey = getMutualStateKey(byEntityType, byEntityId, entityType);
        if (state.mutual[mutualKey] && state.mutual[mutualKey].isFirstFetched) {
          state.mutual[mutualKey].dataMap.set(data.entityId, {
            entityId: data.entityId,
            entityType,
            byEntityId,
            byEntityType,
            mutualId: '',
            data: data.data,
            mutualData: {},
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
            mutualUpdatedAt: data.updatedAt,
          });
        }
      }
    }
  };

  const createEntity = async <T extends Entity>(
    entityType: T,
    entity: DraftEntity<T>,
    opts: CommonOptions = {},
  ) => {
    const entityService = makeEntityService(entityType);
    const onError = opts.onError ?? defaultOnError;

    try {
      const { data } = await entityService.createEntity(entity, opts);

      monoriseStore.setState(
        produce((state) => {
          state.entity[entityType].dataMap.set(data.entityId, data);

          // auto-populate tag store based on entity config
          const tagConfigs = state.config[entityType]?.tags;
          if (tagConfigs) {
            for (const tagConfig of tagConfigs) {
              const { name, processor } = tagConfig;
              const processorResults = processor(
                data as CreatedEntity<Entity>,
              );

              for (const tagKey of Object.keys(state.tag)) {
                const [tagEntityType, tagName, ...paramParts] =
                  tagKey.split('/');

                if (
                  (tagEntityType as unknown as Entity) !== entityType ||
                  tagName !== name
                ) {
                  continue;
                }

                if (!state.tag[tagKey]?.isFirstFetched) {
                  continue;
                }

                // parse params from key
                const keyParams: Record<string, string> = {};
                for (const part of paramParts) {
                  const colonIdx = part.indexOf(':');
                  if (colonIdx > 0) {
                    keyParams[part.substring(0, colonIdx)] =
                      part.substring(colonIdx + 1);
                  }
                }

                // skip query-filtered stores (can't match client-side)
                if (keyParams.query) {
                  continue;
                }

                // check if any processor result matches this tag store's params
                const matches = processorResults.some((result) => {
                  if (keyParams.group && result.group !== keyParams.group) {
                    return false;
                  }
                  if (
                    keyParams.start &&
                    (!result.sortValue || result.sortValue < keyParams.start)
                  ) {
                    return false;
                  }
                  if (
                    keyParams.end &&
                    (!result.sortValue || result.sortValue > keyParams.end)
                  ) {
                    return false;
                  }
                  return true;
                });

                if (matches) {
                  state.tag[tagKey].dataMap.set(data.entityId, data);
                }
              }
            }
          }

          // auto-populate mutual store based on entity config
          populateMutualsForCreatedEntity(
            state,
            entityType,
            data as CreatedEntity<Entity>,
            entity as Record<string, any>,
          );
        }),
        undefined,
        `mr/entity/create/${entityType}`,
      );

      return { data };
    } catch (err) {
      const error: Error & { originalError?: unknown } =
        err instanceof Error ? err : new Error('Unknown error occurred');

      onError?.(error);

      return { error };
    }
  };

  const upsertEntity = async <T extends Entity>(
    entityType: T,
    id: string,
    entity: DraftEntity<T>,
    opts: CommonOptions = {},
  ) => {
    const entityService = makeEntityService(entityType);
    const onError = opts.onError ?? defaultOnError;

    try {
      const { data } = await entityService.upsertEntity(id, entity, opts);

      monoriseStore.setState(
        produce((state) => {
          state.entity[entityType].dataMap.set(data.entityId, data);
        }),
        undefined,
        `mr/entity/upsert/${entityType}/${id}`,
      );
      return { data };
    } catch (err) {
      const error: Error & { originalError?: unknown } =
        err instanceof Error ? err : new Error('Unknown error occurred');
      onError(error);
      return { error };
    }
  };

  // Reconcile an entity's membership across already-loaded tag slices after a
  // data change (edit/adjust). Runs each tag's processor against the new data
  // and, per slice, keeps/adds the entity where it now matches and removes it
  // where it no longer does — so the UI re-buckets optimistically instead of
  // leaving stale members (e.g. a resolved item still sitting in the "open"
  // list) until the backend tag processor catches up. Mirrors the add-only
  // matcher in createEntity, extended with delete-on-mismatch.
  const reconcileTaggedEntityStore = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    state: any,
    entityType: Entity,
    id: string,
    data: CreatedEntity<Entity>,
  ) => {
    const tagConfigs = state.config[entityType]?.tags;
    if (!tagConfigs) return;

    for (const tagConfig of tagConfigs) {
      const { name, processor } = tagConfig;
      const processorResults = processor(data);

      for (const tagKey of Object.keys(state.tag)) {
        const [tagEntityType, tagName, ...paramParts] = tagKey.split('/');
        if (
          (tagEntityType as unknown as Entity) !== entityType ||
          tagName !== name
        ) {
          continue;
        }

        const slice = state.tag[tagKey];
        if (!slice?.dataMap) {
          continue;
        }

        // parse params (group/start/end/query/...) back out of the key
        const keyParams: Record<string, string> = {};
        for (const part of paramParts) {
          const colonIdx = part.indexOf(':');
          if (colonIdx > 0) {
            keyParams[part.substring(0, colonIdx)] = part.substring(
              colonIdx + 1,
            );
          }
        }

        // query-filtered slices can't be evaluated client-side — only patch an
        // existing member's data in place; never add or remove.
        if (keyParams.query) {
          if (slice.dataMap.has(id)) {
            slice.dataMap.set(id, data);
          }
          continue;
        }

        const matches = processorResults.some(
          (result: { group?: string; sortValue?: string }) => {
            if (keyParams.group && result.group !== keyParams.group) {
              return false;
            }
            if (
              keyParams.start &&
              (!result.sortValue || result.sortValue < keyParams.start)
            ) {
              return false;
            }
            if (
              keyParams.end &&
              (!result.sortValue || result.sortValue > keyParams.end)
            ) {
              return false;
            }
            return true;
          },
        );

        if (matches) {
          // keep/patch existing members, and add to newly-matching loaded
          // slices (appended; a later fetch restores exact sort order)
          if (slice.isFirstFetched || slice.dataMap.has(id)) {
            slice.dataMap.set(id, data);
          }
        } else if (slice.dataMap.has(id)) {
          // no longer belongs here — drop the stale member (the re-bucket)
          slice.dataMap.delete(id);
        }
      }
    }
  };

  // Patches an already-edited entity's new `.data` into every loaded mutual
  // list it appears in (the entity's OWN dataMap entry is set by the caller).
  // Shared by editEntity/adjustEntity/executeTransaction's update/adjust
  // branch — kept as one place so the three paths can't drift apart.
  const propagateEntityDataToMutuals = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    state: any,
    entityType: Entity,
    entityId: string,
    data: Record<string, any>,
  ) => {
    for (const key of Object.keys(state.mutual)) {
      const { entity: mutualEntityType } = parseMutualStateKey(key);
      if (mutualEntityType === entityType) {
        const mutual = state.mutual[key].dataMap.get(entityId);
        if (mutual) {
          state.mutual[key].dataMap = new Map(state.mutual[key].dataMap).set(
            entityId,
            { ...mutual, data },
          );
        }
      }
    }
  };

  // Removes a deleted entity's own dataMap entry, its forward-side mutual
  // entries (lists it's a MEMBER of — the reverse side, lists keyed BY this
  // entity, is deleteLocalMutualsByEntity's job, since that needs full entity
  // config), and its tag-store entries. Shared by deleteEntity/
  // executeTransaction's delete branch.
  const deleteEntityFromStores = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    state: any,
    entityType: Entity,
    entityId: string,
  ) => {
    state.entity[entityType]?.dataMap.delete(entityId);

    for (const key of Object.keys(state.mutual)) {
      const { entity: mutualEntityType } = parseMutualStateKey(key);
      if (mutualEntityType === entityType) {
        state.mutual[key].dataMap.delete(entityId);
      }
    }

    for (const tagKey of Object.keys(state.tag)) {
      const [tagEntityType] = tagKey.split('/');
      if ((tagEntityType as unknown as Entity) === entityType) {
        state.tag[tagKey]?.dataMap?.delete(entityId);
      }
    }
  };

  const editEntity = async <T extends Entity>(
    entityType: T,
    id: string,
    entity: Partial<DraftEntity<T>>,
    opts: CommonOptions = {},
  ) => {
    const entityService = makeEntityService(entityType);
    const onError = opts.onError ?? defaultOnError;

    try {
      const { data } = await entityService.editEntity(id, entity, opts);

      monoriseStore.setState(
        produce((state) => {
          state.entity[entityType].dataMap.set(data.entityId, data);

          propagateEntityDataToMutuals(state, entityType, id, data.data);

          // re-bucket across loaded tag slices (add where now matches, drop
          // where it no longer does) instead of only patching in place
          reconcileTaggedEntityStore(
            state,
            entityType,
            id,
            data as CreatedEntity<Entity>,
          );
        }),
        undefined,
        `mr/entity/edit/${entityType}/${id}`,
      );
      return { data };
    } catch (err) {
      const error: Error & { originalError?: unknown } =
        err instanceof Error ? err : new Error('Unknown error occurred');
      onError(error);
      return { error };
    }
  };

  const adjustEntity = async <T extends Entity>(
    entityType: T,
    id: string,
    adjustments: Record<string, number>,
    opts: CommonOptions = {},
  ) => {
    const entityService = makeEntityService(entityType);
    const onError = opts.onError ?? defaultOnError;

    try {
      const { data } = await entityService.adjustEntity(id, adjustments, opts);

      // Update local store with server response
      monoriseStore.setState(
        produce((state) => {
          state.entity[entityType].dataMap.set(data.entityId, data);

          propagateEntityDataToMutuals(state, entityType, id, data.data);

          // Propagate to tag stores — re-bucket across loaded slices (an
          // adjustment can move an entity between groups when group/sortValue
          // derive from the adjusted fields), not just patch in place.
          reconcileTaggedEntityStore(
            state,
            entityType,
            id,
            data as CreatedEntity<Entity>,
          );
        }),
        undefined,
        `mr/entity/adjust/${entityType}/${id}`,
      );

      return { data };
    } catch (err: any) {
      // Constraint violated — refetch entity to get latest state
      if (err?.response?.status === 409) {
        await getEntity(entityType, id, { forceFetch: true });
      }

      const error: Error & { originalError?: unknown } =
        err instanceof Error ? err : new Error('Unknown error occurred');
      onError(error);
      return { error };
    }
  };

  const deleteEntity = async <T extends Entity>(
    entityType: T,
    id: string,
    opts: CommonOptions = {},
  ) => {
    const entityService = makeEntityService(entityType);
    const onError = opts.onError ?? defaultOnError;

    try {
      await entityService.deleteEntity(id, opts);
      deleteLocalMutualsByEntity(entityType, id);

      monoriseStore.setState(
        produce((state) => {
          deleteEntityFromStores(state, entityType, id);
        }),
        undefined,
        `mr/entity/delete/${entityType}/${id}`,
      );
      return { data: { entityId: id } }; // Indicate success with the deleted ID
    } catch (err) {
      const error: Error & { originalError?: unknown } =
        err instanceof Error ? err : new Error('Unknown error occurred');
      onError(error);
      return { error };
    }
  };

  // Runs a multi-entity atomic write (`coreService.executeTransaction`,
  // backed by a real DynamoDB TransactWriteItems) and folds each op's result
  // back into the local store — the same cache guarantee createEntity/
  // editEntity/adjustEntity/deleteEntity already give a single-entity call,
  // so a caller doesn't have to hand-roll cache patching (or force a
  // refetch) just because their write happened to span more than one entity.
  const executeTransaction = async (
    operations: TransactionOperation[],
    opts: CommonOptions = {},
  ) => {
    const onError = opts.onError ?? defaultOnError;
    const isInterruptive = opts.isInterruptive ?? true;
    const opRequestKeys = operations.map(getTransactionOperationRequestKey);
    // The joined key is namespaced under `transaction/` so it can never
    // match a single-entity action's own key — using e.g. opRequestKeys[0]
    // directly would let a standalone editEntity/createEntity call on that
    // same target collide with this transaction via lib/api.ts's
    // `ongoingRequests` dedupe, handing either caller the other's
    // differently-shaped response. Still deterministic: identical operation
    // sets dedupe onto one request, same as any other action's key.
    const callRequestKey =
      opts.requestKey || getTransactionCallRequestKey(operations);
    const callPromise = coreService.executeTransaction(operations, {
      ...opts,
      requestKey: callRequestKey,
    });
    const loadingMessage = opts.feedback?.loading ?? 'Processing transaction';

    // Drive the same per-entity loading/error signal a standalone
    // createEntity/editEntity/adjustEntity/deleteEntity call on each op's
    // target would have driven, so a component checking any op's target via
    // useLoadStore/getError sees "mutating" during a transaction too. `request`
    // is deliberately omitted here — passing it would register these keys in
    // `ongoingRequests` too, letting a concurrent standalone call on the same
    // target dedupe onto (and never actually send) its own write. These keys
    // exist purely for loading/error *signaling*, not for de-duplicating this
    // HTTP call — that's callRequestKey's job.
    for (const requestKey of opRequestKeys) {
      startLoading({ requestKey, isInterruptive, message: loadingMessage });
    }

    // Tracks whether the network call itself has already resolved and had
    // its success-path loading/error signaling run — so if the cache-fold
    // below throws (a tag processor, a bad payload, ...), the catch block
    // doesn't ALSO run the failure-path signaling for keys that were already
    // correctly cleared, which would both mis-decrement stacks shared with
    // other concurrent calls on those same keys and report a transaction
    // that actually committed as failed.
    let settled = false;

    try {
      const { data } = await callPromise;

      for (const requestKey of opRequestKeys) {
        endLoading({ requestKey, isInterruptive, skipDedupe: true });
        clearError(requestKey);
      }
      settled = true;

      const deletedEntities: { entityType: Entity; entityId: string }[] = [];

      monoriseStore.setState(
        produce((state) => {
          data.results.forEach((entry, index) => {
            const { entityType, entityId } = entry;

            if (entry.operation === 'deleteEntity') {
              deleteEntityFromStores(state, entityType, entityId);
              deletedEntities.push({ entityType, entityId });
              return;
            }

            if (entry.operation === 'createEntity') {
              const createdEntity = {
                entityId,
                entityType,
                data: entry.data ?? {},
                createdAt: entry.createdAt,
                updatedAt: entry.updatedAt,
              } as unknown as CreatedEntity<Entity>;

              state.entity[entityType].dataMap.set(entityId, createdEntity);

              const op = operations[index] as TransactionCreateEntity;
              populateMutualsForCreatedEntity(
                state,
                entityType,
                createdEntity,
                op?.payload as Record<string, any>,
              );
              reconcileTaggedEntityStore(
                state,
                entityType,
                entityId,
                createdEntity,
              );
              return;
            }

            // updateEntity / adjustEntity. `entry.data` is populated either
            // by the write itself or by transaction.service.ts's Phase 4
            // read-back — only patch the cache when we actually have fresh
            // data to patch it with, rather than guessing at a partial merge.
            const existing = state.entity[entityType]?.dataMap.get(entityId);
            if (!existing && !entry.data) return;

            if (!entry.data) {
              // No fresh data, but we do know the write landed — bump the
              // timestamp so at least `updatedAt` isn't stale, without
              // touching `.data` (and so without needing to re-bucket tags).
              if (entry.updatedAt) {
                state.entity[entityType].dataMap.set(entityId, {
                  ...existing,
                  updatedAt: entry.updatedAt,
                });
              }
              return;
            }

            const updated = {
              ...(existing ?? { entityId, entityType }),
              data: entry.data,
              updatedAt: entry.updatedAt ?? existing?.updatedAt,
            } as unknown as CreatedEntity<Entity>;

            state.entity[entityType].dataMap.set(entityId, updated);
            propagateEntityDataToMutuals(state, entityType, entityId, updated.data);
            reconcileTaggedEntityStore(state, entityType, entityId, updated);
          });
        }),
        undefined,
        'mr/entity/execute-transaction',
      );

      // Reverse-side mutual cleanup for deletes (lists keyed BY the deleted
      // entity itself) — mirrors deleteEntity's own use of this helper, which
      // needs full entity config and does its own separate setState.
      for (const { entityType, entityId } of deletedEntities) {
        deleteLocalMutualsByEntity(entityType, entityId);
      }

      return { data };
    } catch (err) {
      if (!settled) {
        // The axios interceptor already ran its own error handling for
        // callRequestKey (endLoading + setError) — read back whatever
        // appError it computed and mirror it onto every op's key, rather
        // than re-deriving the AxiosError → ApplicationRequestError shaping
        // logic here.
        const callAppError = getError(callRequestKey);
        for (const requestKey of opRequestKeys) {
          endLoading({ requestKey, isInterruptive, skipDedupe: true });
          if (callAppError) {
            setError({ requestKey, error: callAppError });
          }
        }
      }

      const error: Error & { originalError?: unknown } =
        err instanceof Error ? err : new Error('Unknown error occurred');
      onError(error);
      return { error };
    }
  };

  const listEntitiesByEntity = async <B extends Entity, T extends Entity>(
    byEntityType: B,
    entityType: T,
    id: string,
    opts: CommonOptions = {},
    chainEntityQuery?: string,
  ) => {
    const onError = opts.onError ?? defaultOnError;
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
    const requestKey = getMutualRequestKey(
      'list',
      byEntityType,
      entityType,
      id,
      undefined,
      chainEntityQuery,
    );
    const isLoading = checkIsLoading(requestKey);
    const error = getError(requestKey);
    const { forceFetch } = opts;

    if (!forceFetch) {
      if (error) {
        onError(error);
        return { error };
      }

      if (isFirstFetched || isLoading) {
        return {
          data: {
            entities: Array.from(mutualState.dataMap?.values() || []),
            lastKey: mutualState.lastKey,
          },
        };
      }
    }

    try {
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

          // prepare or extend the mutual entry
          const existing = state.mutual[selfKey];
          if (existing) {
            // extend the existing map
            const incoming = convertToMap(entities, 'entityId');
            for (const [k, v] of incoming) {
              existing.dataMap.set(k, v);
            }
            existing.isFirstFetched = true;
            existing.lastKey = lastKey;
          } else {
            // first time: create it
            state.mutual[selfKey] = {
              dataMap: convertToMap(entities, 'entityId'),
              isFirstFetched: true,
              lastKey,
            };
          }
        }),
        undefined,
        `mr/mutual/list/${selfKey}`,
      );

      return { data };
    } catch (err) {
      const error: Error & { originalError?: unknown } =
        err instanceof Error ? err : new Error('Unknown error occurred');

      return { error };
    }
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
    const requestKey = getMutualRequestKey(
      'get',
      byEntityType,
      entityType,
      byEntityId,
      entityId,
    );
    const isLoading = checkIsLoading(requestKey);
    const error = getError(requestKey);
    const onError = opts.onError ?? defaultOnError;

    if (error) {
      onError?.(error);
      return { error };
    }

    if (!byEntityId || isLoading) {
      return {
        data: mutualState.dataMap?.get(entityId) as Mutual<B, T>,
      };
    }

    if (mutualState.dataMap?.get(entityId)) {
      return {
        data: mutualState.dataMap.get(entityId) as Mutual<B, T>,
      };
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
        const error: Error & { originalError?: unknown } =
          err instanceof Error ? err : new Error('Unknown error occurred');
        return { error };
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
    return { data: mutual as Mutual<B, T> };
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
    const onError = opts.onError ?? defaultOnError;

    try {
      const { data: mutual } = await mutualService.createMutual(
        byEntityId,
        entityId,
        payload,
        opts,
      );

      monoriseStore.setState(
        produce((state) => {
          const bySide = getMutualStateKey(
            byEntityType,
            byEntityId,
            entityType,
          );
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

          const byEntityData =
            state.entity[mutual.byEntityType]?.dataMap.get(mutual.byEntityId)
              ?.data ?? {};
          state.mutual[side].dataMap = new Map(state.mutual[side]?.dataMap).set(
            mutual.byEntityId,
            flipMutual(mutual, byEntityData),
          );
        }),
        undefined,
        `mr/mutual/create/${getMutualStateKey(byEntityType, byEntityId, entityType, entityId)}`,
      );
      return { data: mutual };
    } catch (err) {
      const error: Error & { originalError?: unknown } =
        err instanceof Error ? err : new Error('Unknown error occurred');
      onError(error);
      return { error };
    }
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

        const byEntityData =
          state.entity[mutual.byEntityType]?.dataMap.get(mutual.byEntityId)
            ?.data ?? {};
        state.mutual[side].dataMap = new Map(state.mutual[side]?.dataMap).set(
          mutual.byEntityId,
          flipMutual(mutual, byEntityData),
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

        const byEntityData =
          state.entity[mutual.byEntityType]?.dataMap.get(mutual.byEntityId)
            ?.data ?? {};
        state.mutual[side].dataMap = new Map(state.mutual[side]?.dataMap).set(
          byEntityId,
          flipMutual(mutual, byEntityData),
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
    const onError = opts.onError ?? defaultOnError;

    try {
      const { data: mutual } = await mutualService.editMutual(
        byEntityId,
        entityId,
        payload,
        opts,
      );

      monoriseStore.setState(
        produce((state) => {
          const bySide = getMutualStateKey(
            byEntityType,
            byEntityId,
            entityType,
          );
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

          const byEntityData =
            state.entity[mutual.byEntityType]?.dataMap.get(mutual.byEntityId)
              ?.data ?? {};
          state.mutual[side].dataMap = new Map(state.mutual[side]?.dataMap).set(
            mutual.byEntityId,
            flipMutual(mutual, byEntityData),
          );
        }),
        undefined,
        `mr/mutual/edit/${getMutualStateKey(byEntityType, byEntityId, entityType, entityId)}`,
      );
      return { data: mutual };
    } catch (err) {
      const error: Error & { originalError?: unknown } =
        err instanceof Error ? err : new Error('Unknown error occurred');
      onError(error);
      return { error };
    }
  };

  const deleteMutual = async <B extends Entity, T extends Entity>(
    byEntityType: B,
    entityType: T,
    byEntityId: string,
    entityId = '',
    opts: CommonOptions = {},
  ) => {
    const mutualService = makeMutualService(byEntityType, entityType);
    const onError = opts.onError ?? defaultOnError;

    try {
      const { data } = await mutualService.deleteMutual(
        byEntityId,
        entityId,
        opts,
      );

      monoriseStore.setState(
        produce((state) => {
          const bySide = getMutualStateKey(
            byEntityType,
            byEntityId,
            entityType,
          );
          const side = getMutualStateKey(entityType, entityId, byEntityType);

          state.mutual[bySide].dataMap.delete(data.entityId);

          if (state.mutual[side]) {
            state.mutual[side].dataMap.delete(data.byEntityId);
          }
        }),
        undefined,
        `mr/mutual/delete/${getMutualStateKey(byEntityType, byEntityId, entityType, entityId)}`,
      );
      return { data };
    } catch (err) {
      const error: Error & { originalError?: unknown } =
        err instanceof Error ? err : new Error('Unknown error occurred');
      onError(error);
      return { error };
    }
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
        const bySideDataMap = new Map(state.mutual[bySide]?.dataMap);
        const sideDataMap = new Map(state.mutual[side]?.dataMap);
        bySideDataMap.delete(entityId);
        sideDataMap.delete(byEntityId);

        if (state.mutual[bySide]) {
          state.mutual[bySide].dataMap.delete(entityId);
        }
        if (state.mutual[side]) {
          state.mutual[side].dataMap.delete(byEntityId);
        }
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
    const entityConfig = store.config; // Assuming store.config holds mutual related configurations
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
        const dataMap = new Map(store.mutual[side]?.dataMap); // Use optional chaining
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
        // This is a full replacement, might not be desired for partial updates.
        // If state.mutual can contain other keys, this might clear them.
        // Consider a more granular update if needed.
        for (const key in updatedState) {
          state.mutual[key] = updatedState[key];
        }
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
    const requestKey = getEntityRequestKey('get', entityType, id);
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
          const { data, error: fetchError } = await getEntity(entityType, id, {
            ...opts,
            forceFetch: true,
          });
          if (fetchError) {
            // Handle refetch error if necessary, e.g., throw or set local state
          }
          return data;
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
    const requestKey = getUniqueFieldRequestKey(
      entityType,
      fieldName,
      value || '',
    );
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
          const { data, error: fetchError } = await getEntityByUniqueField(
            entityType,
            fieldName,
            value,
            {
              ...opts,
              forceFetch: true,
            },
          );
          if (fetchError) {
            // Handle refetch error if necessary
          }
          return data;
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
      limit?: number;
    } = { limit: 20 },
    opts: CommonOptions & { searchInterval?: number } = {},
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
    listMore: () => void;
    refetch: () => void;
  } => {
    const requestKey = getEntityRequestKey('list', entityType);
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
    const [limit, setLimit] = useState(params.limit);
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
      if (params?.limit !== limit) {
        setLimit(params.limit);
      }
    }, [limit, params.limit]);

    useEffect(() => {
      if (!isFirstFetched || opts?.forceFetch) {
        listEntities(entityType, { skRange, all, limit }, opts);
      }
    }, [all, entityType, skRange, opts, isFirstFetched, opts?.forceFetch, limit]);

    useEffect(() => {
      let queryTimeout: NodeJS.Timeout;

      if (query?.length) {
        setIsSearching(true);
        queryTimeout = setTimeout(async () => {
          await searchEntities(entityType, query);
          setIsSearching(false);
        }, opts.searchInterval ?? 700);
      }

      return () => queryTimeout && clearTimeout(queryTimeout);
    }, [entityType, query]);

    useEffect(() => {
      if (!query) {
        const dataMapArray = Array.from(dataMap.values()).sort(
          byEntityId,
        ) as CreatedEntity<T>[];
        // Compare size AND content so that edits which keep the same set of
        // entityIds but mutate their data (e.g. editEntity) still propagate
        // to the local `entities` snapshot. Matches the comparison already
        // used in `useMutuals`.
        if (
          dataMap.size !== entities?.length ||
          dataMapArray.some(
            (item, index) =>
              JSON.stringify(item) !== JSON.stringify(entities?.[index]),
          )
        ) {
          setIsSearching(false);
          setEntities(dataMapArray);
        }
      }

      if (query) {
        setEntities(searchResults as CreatedEntity<T>[]);
      }
    }, [
      dataMap,
      dataMap.size,
      entities,
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
      refetch: async () => {
        if (entityType && query) {
          await searchEntities(entityType, query);
          return;
        }
        await listEntities(
          entityType,
          { skRange, all },
          {
            ...opts,
            forceFetch: true,
          },
        );
      },
      listMore: async () => {
        if (!lastKey) return;

        await listMoreEntities(entityType, {
          ...opts,
          limit,
          forceFetch: true,
        });
      },
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
    const requestKey = getMutualRequestKey(
      'get',
      byEntityType,
      entityType,
      byId,
      id,
    );
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
    listMore?: () => void;
    refetch?: () => Promise<any>;
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
    const requestKey = getMutualRequestKey(
      'list',
      byEntityType,
      entityType,
      byId || '',
      undefined,
      chainEntityQuery,
    );
    const isLoading = useLoadStore(requestKey);
    const error = useErrorStore(requestKey);

    useEffect(() => {
      if (byEntityType && entityType && byId && (!isFirstFetched || opts?.forceFetch)) {
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
        setMutuals(dataMapArray as Mutual<B, T>[]);
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
      refetch: async () => {
        if (byEntityType && entityType && byId) {
          return await listEntitiesByEntity(
            byEntityType,
            entityType,
            byId,
            {
              ...opts,
              forceFetch: true,
              stateKey,
            },
            chainEntityQuery,
          );
        }
      },
      ...(lastKey && {
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
      }),
    };
  };

  // Order a loaded tag slice the same way the server does, so optimistic
  // edits/adjusts land in their true position instead of appending to the end.
  // The backend queries tags with ScanIndexForward:false — i.e. descending by
  // the tag sort key `${sortValue}#${entityType}#${entityId}` (see
  // TaggedEntity.get sk()). We rebuild that exact key per entity from the tag's
  // processor and sort descending, reproducing DynamoDB's ordering (sortValue
  // first, entityId tiebreak, identical string coercion). This only re-orders
  // the loaded window; on a paginated list an item whose new sortValue belongs
  // on an unfetched page may sit at the boundary until the next fetch — a
  // per-user, self-healing approximation, strictly better than not sorting.
  const sortTaggedEntitiesLikeServer = <T extends Entity>(
    arr: CreatedEntity<T>[],
    entityType: Entity,
    tagName: string,
    group?: string,
  ): CreatedEntity<T>[] => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tagConfig = (monoriseStore.getState().config[entityType] as any)
      ?.tags?.find((t: { name: string }) => t.name === tagName);

    const keyOf = (entity: CreatedEntity<T>): string => {
      let sortValue: unknown;
      if (tagConfig?.processor) {
        const results = tagConfig.processor(entity) as {
          group?: string;
          sortValue?: unknown;
        }[];
        const match = group
          ? results.find((r) => r.group === group)
          : results[0];
        sortValue = match?.sortValue;
      }
      return `${sortValue ? `${sortValue}#` : ''}${entityType}#${entity.entityId}`;
    };

    return arr
      .map((entity) => ({ entity, key: keyOf(entity) }))
      .sort((a, b) => (a.key === b.key ? 0 : a.key < b.key ? 1 : -1))
      .map((x) => x.entity);
  };

  const useTaggedEntities = <T extends Entity>(
    entityType: T,
    tagName: string,
    opts: CommonOptions & { params?: ListEntitiesByTagParams } = {},
  ) => {
    const { params } = opts || {};
    const stateKey = getTagStateKey(entityType, tagName, params);
    const state = monoriseStore((state) => state.tag[stateKey]);
    const { dataMap, isFirstFetched, lastKey } = state || {
      dataMap: new Map(),
    };
    const [entities, setEntities] = useState<CreatedEntity<T>[]>([]);
    const requestKey = getTagRequestKey('list', entityType, tagName, params);
    const isLoading = useLoadStore(requestKey);
    const error = useErrorStore(requestKey);

    useEffect(() => {
      if (entityType && tagName && Object.keys(params).length > 0) {
        listEntitiesByTag(entityType, tagName, opts);
      }
    }, [entityType, opts, tagName, params, opts?.forceFetch]);

    useEffect(() => {
      const dataMapArray = sortTaggedEntitiesLikeServer(
        Array.from(dataMap.values()) as CreatedEntity<T>[],
        entityType,
        tagName,
        params?.group,
      );
      if (
        dataMap.size !== entities?.length ||
        dataMapArray.some(
          (item, index) =>
            JSON.stringify(item) !== JSON.stringify(entities[index]),
        )
      ) {
        setEntities(dataMapArray);
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

  const updateLocalTaggedEntity = <T extends Entity>(
    entityType: T,
    entityId: string,
    tagName: string,
    data: Partial<DraftEntity<T>> = {},
    params?: ListEntitiesByTagParams,
  ) => {
    const tagKey = getTagStateKey(
      entityType,
      tagName,
      params as Record<string, string>,
    );

    monoriseStore.setState(
      produce((state) => {
        const entity = state.tag[tagKey]?.dataMap?.get(entityId);
        if (entity) {
          state.tag[tagKey].dataMap.set(entityId, {
            ...entity,
            data: { ...entity.data, ...data },
          });
        }
      }),
      undefined,
      `mr/tag/local-update/${entityType}/${entityId}`,
    );
  };

  const deleteLocalTaggedEntity = <T extends Entity>(
    entityType: T,
    entityId: string,
    tagName: string,
    params?: ListEntitiesByTagParams,
  ) => {
    const tagKey = getTagStateKey(
      entityType,
      tagName,
      params as Record<string, string>,
    );

    monoriseStore.setState(
      produce((state) => {
        if (state.tag[tagKey]?.dataMap?.has(entityId)) {
          state.tag[tagKey].dataMap.delete(entityId);
        }
      }),
      undefined,
      `mr/tag/local-delete/${entityType}/${entityId}`,
    );
  };

  return {
    listMoreEntities,
    createEntity,
    upsertEntity,
    getEntity,
    editEntity,
    adjustEntity,
    deleteEntity,
    executeTransaction,
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
    updateLocalTaggedEntity,
    deleteLocalTaggedEntity,
  };
};

export { initCoreActions };

export type CoreActions = ReturnType<typeof initCoreActions>;
