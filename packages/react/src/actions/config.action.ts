import type {
  CreatedEntity,
  Entity,
  MonoriseEntityConfig,
} from '@monorise/base';
import { produce } from 'immer';
import type { MonoriseStore } from '../store/monorise.store';
import type { CommonStore } from '../types/monorise.type';

const initConfigActions = (store: MonoriseStore) => {
  const setConfig = (config: Record<Entity, MonoriseEntityConfig>) => {
    const entityMaps = Object.keys(config).reduce(
      (acc, entity) => {
        acc[entity as any] = {
          dataMap: new Map<string, CreatedEntity<Entity>>(),
          isFirstFetched: false,
          lastKey: '',
        } as CommonStore<CreatedEntity<Entity>>;
        return acc;
      },
      {} as Record<Entity, CommonStore<CreatedEntity<Entity>>>,
    );

    store.setState(
      produce((state) => {
        state.config = config;
        state.entity = entityMaps;
      }),
    );
  };

  const getConfig = () => {
    return store.getState().config;
  };

  const useConfig = () => {
    const config = store((state) => state.config);

    return config;
  };

  return {
    setConfig,
    getConfig,
    useConfig,
  };
};

export { initConfigActions };

export type ConfigActions = ReturnType<typeof initConfigActions>;
