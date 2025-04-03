import type { Entity, MonoriseEntityConfig } from '@monorise/base';
import type { AxiosResponse } from 'axios';
import { initAppActions } from './actions/app.action';
import { initAuthActions } from './actions/auth.action';
import { initConfigActions } from './actions/config.action';
import { initCoreActions } from './actions/core.action';
import { initAxiosInterceptor, injectAxiosInterceptor } from './lib/api';
import initAuthService from './services/auth.service';
import initCoreService from './services/core.service';
import initFilestoreService from './services/filestore.service';
import { initMonoriseStore } from './store/monorise.store';
import {
  Mutual,
  MutualData,
  MutualDataMapping,
  MutualDataWithIndex,
} from './types/mutual.type';

type Options<T extends Record<string, React.ComponentType<any>>> = {
  authBaseUrl?: string;
  filestoreBaseUrl?: string;
  entityBaseUrl?: string;
  mutualBaseUrl?: string;
  tagBaseUrl?: string;
  modals?: T;
  entityConfig: Record<Entity, MonoriseEntityConfig>;
  onApiSuccess?: <T>(
    response: AxiosResponse<T>,
    feedbackSuccess:
      | ((data: AxiosResponse<T>['data']) => React.ReactNode)
      | string
      | boolean,
  ) => void;
};

const initMonorise = () => {
  const { monoriseStore: store, setOptions: setMonoriseOptions } =
    initMonoriseStore();
  const appActions = initAppActions(store);
  const configActions = initConfigActions(store);
  const axios = initAxiosInterceptor(store, appActions);

  const authService = initAuthService(axios);
  const filestoreService = initFilestoreService(axios);
  const coreService = initCoreService(store, axios);

  const authActions = initAuthActions(store, authService);
  const coreActions = initCoreActions(store, appActions, coreService);

  const axiosInterceptor = injectAxiosInterceptor(
    appActions,
    authActions,
    axios,
  );

  const config = <T extends Record<string, React.ComponentType<any>>>(
    opts: Options<T>,
  ) => {
    setMonoriseOptions({
      modals: opts.modals,
    });
    configActions.setConfig(opts.entityConfig);
    authService.setOptions({
      apiBaseUrl: opts.authBaseUrl,
    });
    filestoreService.setOptions({
      apiBaseUrl: opts.filestoreBaseUrl,
    });
    coreService.setOptions({
      entityApiBaseUrl: opts.entityBaseUrl,
      mutualApiBaseUrl: opts.mutualBaseUrl,
      tagApiBaseUrl: opts.tagBaseUrl,
    });
    axiosInterceptor.setOptions({
      onApiSuccess: opts.onApiSuccess,
    });
  };

  return {
    config,
    store,
    axios,
    authService,
    filestoreService,
    coreService,
    ...configActions,
    ...appActions,
    ...authActions,
    ...coreActions,
  };
};

const Monorise = initMonorise();

const {
  store,
  axios,
  authService,
  filestoreService,
  coreService,
  setConfig,
  getConfig,
  useConfig,
  startLoading,
  endLoading,
  setError,
  getError,
  clearError,
  openModal,
  closeModal,
  useLoadStore,
  useInterruptiveLoadStore,
  useErrorStore,
  useModalStore,
  requestLogin,
  useProfile,
  getProfile,
  useIsUnauthorized,
  setIsUnauthorized,
  logout,
  listMoreEntities,
  createEntity,
  upsertEntity,
  editEntity,
  updateLocalEntity,
  deleteEntity,
  getMutual,
  createMutual,
  createLocalMutual,
  upsertLocalMutual,
  editMutual,
  deleteMutual,
  deleteLocalMutual,
  useEntity,
  useEntities,
  useMutual,
  useMutuals,
  useEntityState,
} = Monorise;

export {
  store,
  axios,
  authService,
  filestoreService,
  coreService,
  setConfig,
  getConfig,
  useConfig,
  startLoading,
  endLoading,
  setError,
  getError,
  clearError,
  openModal,
  closeModal,
  useLoadStore,
  useInterruptiveLoadStore,
  useErrorStore,
  useModalStore,
  requestLogin,
  useProfile,
  getProfile,
  useIsUnauthorized,
  setIsUnauthorized,
  logout,
  listMoreEntities,
  createEntity,
  upsertEntity,
  editEntity,
  updateLocalEntity,
  deleteEntity,
  getMutual,
  createMutual,
  createLocalMutual,
  upsertLocalMutual,
  editMutual,
  deleteMutual,
  deleteLocalMutual,
  useEntity,
  useEntities,
  useMutual,
  useMutuals,
  useEntityState,
};

export default Monorise;

export { MutualDataWithIndex, MutualDataMapping, MutualData, Mutual };

export type {
  CreatedEntity,
  DraftEntity,
  Entity,
  EntitySchemaMap,
} from '@monorise/base';
