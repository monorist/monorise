// @vitest-environment happy-dom

import type { Entity } from '@monorise/base';
import { act, renderHook } from '@testing-library/react';
import {
  AxiosError,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { describe, expect, it, vi } from 'vitest';
import { initAxiosInterceptor, injectAxiosInterceptor } from '../../lib/api';
import initCoreService from '../../services/core.service';
import { initMonoriseStore } from '../../store/monorise.store';
import { initAppActions } from '../app.action';
import { initConfigActions } from '../config.action';
import { initCoreActions } from '../core.action';

const USER = 'user' as unknown as Entity;

type Adapter = (config: InternalAxiosRequestConfig) => Promise<AxiosResponse>;

const makeHarness = (adapter: Adapter) => {
  const { monoriseStore: store } = initMonoriseStore();
  const appActions = initAppActions(store);
  const axios = initAxiosInterceptor(store, appActions);
  axios.defaults.adapter = vi.fn(adapter);
  injectAxiosInterceptor(appActions, axios);
  initConfigActions(store).setConfig({
    user: { name: 'user', displayName: 'User' },
  } as never);
  return {
    actions: initCoreActions(store, appActions, initCoreService(store, axios)),
    adapter: axios.defaults.adapter as ReturnType<typeof vi.fn>,
  };
};

describe('request errors', () => {
  it("carry the server's status, code and body", async () => {
    const body = {
      code: 'UNIQUE_VALUE_EXISTS',
      message: "email 'a@b.co' already exists",
    };
    const h = makeHarness(async (config) => {
      throw new AxiosError('conflict', 'ERR_BAD_REQUEST', config, undefined, {
        config,
        data: body,
        headers: {},
        status: 409,
        statusText: 'Conflict',
      });
    });
    const hook = renderHook(() =>
      h.actions.useCreateEntity(USER, { isInterruptive: false }),
    );

    let result!: Awaited<ReturnType<typeof hook.result.current.mutate>>;
    await act(async () => {
      result = await hook.result.current.mutate({ email: 'a@b.co' } as never);
    });

    expect(result.error).toBeInstanceOf(Error);
    expect(result.error).toMatchObject({
      status: 409,
      code: 'UNIQUE_VALUE_EXISTS',
      data: body,
    });
  });
});

describe('useTaggedEntities', () => {
  const tagged = async () => ({
    data: { entities: [], lastKey: undefined },
    headers: {},
    status: 200,
    statusText: 'OK',
  });

  it('waits while a param is undefined, and fetches once it is set', async () => {
    const h = makeHarness(tagged as never);
    const hook = renderHook(
      ({ group }: { group?: string }) =>
        h.actions.useTaggedEntities(USER, 'organisation', {
          params: { group },
        }),
      { initialProps: { group: undefined as string | undefined } },
    );
    await act(async () => {});

    expect(h.adapter).not.toHaveBeenCalled();

    hook.rerender({ group: 'org-1' });
    await act(async () => {});

    expect(h.adapter).toHaveBeenCalledTimes(1);
    const { url, params } = h.adapter.mock.calls[0][0];
    expect(`${url} ${JSON.stringify(params)}`).toContain('org-1');
  });

  it('does not throw or fetch without params', async () => {
    const h = makeHarness(tagged as never);

    renderHook(() => h.actions.useTaggedEntities(USER, 'organisation'));
    await act(async () => {});

    expect(h.adapter).not.toHaveBeenCalled();
  });
});
