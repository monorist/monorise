import type { Entity } from '@monorise/base';
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { describe, expect, it, vi } from 'vitest';
import { initAppActions } from '../../actions/app.action';
import { initConfigActions } from '../../actions/config.action';
import { initAxiosInterceptor } from '../../lib/api';
import { initMonoriseStore } from '../../store/monorise.store';
import initCoreService, { type CoreService } from '../core.service';

const USER = 'user' as unknown as Entity;
const TEAM = 'team' as unknown as Entity;

const makeHarness = () => {
  const { monoriseStore } = initMonoriseStore();
  const appActions = initAppActions(monoriseStore);
  initConfigActions(monoriseStore).setConfig({
    user: { name: 'user', displayName: 'User' },
    team: { name: 'team', displayName: 'Team' },
  } as never);
  const axios = initAxiosInterceptor(monoriseStore, appActions);
  const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
    return {
      config,
      data: {},
      headers: {},
      status: 200,
      statusText: 'OK',
    } satisfies AxiosResponse;
  });
  axios.defaults.adapter = adapter;

  return {
    adapter,
    coreService: initCoreService(monoriseStore, axios),
  };
};

type MutationCall = (
  coreService: CoreService,
  requestKey?: string,
) => Promise<unknown>;

const mutationCalls: Array<[string, MutationCall]> = [
  [
    'createEntity',
    (core, requestKey) =>
      core
        .makeEntityService(USER)
        .createEntity({ name: 'Ada' } as never, { requestKey }),
  ],
  [
    'upsertEntity',
    (core, requestKey) =>
      core
        .makeEntityService(USER)
        .upsertEntity('u1', { name: 'Ada' } as never, { requestKey }),
  ],
  [
    'editEntity',
    (core, requestKey) =>
      core
        .makeEntityService(USER)
        .editEntity('u1', { name: 'Ada' } as never, { requestKey }),
  ],
  [
    'adjustEntity',
    (core, requestKey) =>
      core
        .makeEntityService(USER)
        .adjustEntity('u1', { score: 1 }, { requestKey }),
  ],
  [
    'deleteEntity',
    (core, requestKey) =>
      core.makeEntityService(USER).deleteEntity('u1', { requestKey }),
  ],
  [
    'createMutual',
    (core, requestKey) =>
      core
        .makeMutualService(USER, TEAM)
        .createMutual('u1', 't1', {}, { requestKey }),
  ],
  [
    'editMutual',
    (core, requestKey) =>
      core
        .makeMutualService(USER, TEAM)
        .editMutual('u1', 't1', {}, { requestKey }),
  ],
  [
    'deleteMutual',
    (core, requestKey) =>
      core
        .makeMutualService(USER, TEAM)
        .deleteMutual('u1', 't1', { requestKey }),
  ],
];

describe.each(mutationCalls)('%s request dedupe', (_name, mutate) => {
  it('sends concurrent writes separately by default', async () => {
    const { adapter, coreService } = makeHarness();

    await Promise.all([mutate(coreService), mutate(coreService)]);

    expect(adapter).toHaveBeenCalledTimes(2);
    const [firstConfig] = adapter.mock.calls[0];
    const [secondConfig] = adapter.mock.calls[1];
    expect(firstConfig.requestKey).not.toBe(secondConfig.requestKey);
    expect(firstConfig.stateKeys).toEqual(secondConfig.stateKeys);
  });

  it('deduplicates writes with the same explicit request key', async () => {
    const { adapter, coreService } = makeHarness();

    await Promise.all([
      mutate(coreService, 'intentional-dedupe'),
      mutate(coreService, 'intentional-dedupe'),
    ]);

    expect(adapter).toHaveBeenCalledTimes(1);
  });
});
