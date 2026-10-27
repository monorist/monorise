// @vitest-environment happy-dom

import type { Entity } from '@monorise/base';
import { act, renderHook } from '@testing-library/react';
import {
  AxiosError,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { transactional as tx } from '../../helpers/transactional';
import { initAxiosInterceptor, injectAxiosInterceptor } from '../../lib/api';
import initCoreService from '../../services/core.service';
import { initMonoriseStore } from '../../store/monorise.store';
import { initAppActions } from '../app.action';
import type { AuthActions } from '../auth.action';
import { initConfigActions } from '../config.action';
import { initCoreActions } from '../core.action';

const USER = 'user' as unknown as Entity;
const T0 = '2026-10-27T00:00:00.000Z';
const LOADING_SETTLE_MS = 500;

const user = (entityId: string, name: string) => ({
  entityType: USER,
  entityId,
  data: { name },
  createdAt: T0,
  updatedAt: T0,
});

type Adapter = (config: InternalAxiosRequestConfig) => Promise<AxiosResponse>;

const makeHarness = (adapter: Adapter) => {
  const { monoriseStore: store } = initMonoriseStore();
  const appActions = initAppActions(store);
  const axios = initAxiosInterceptor(store, appActions);
  axios.defaults.adapter = vi.fn(adapter);
  injectAxiosInterceptor(
    appActions,
    { setIsUnauthorized: vi.fn() } as unknown as AuthActions,
    axios,
  );
  initConfigActions(store).setConfig({
    user: { name: 'user', displayName: 'User' },
  } as never);
  const actions = initCoreActions(
    store,
    appActions,
    initCoreService(store, axios),
  );

  return {
    actions,
    adapter: axios.defaults.adapter as ReturnType<typeof vi.fn>,
  };
};

const response = (
  config: InternalAxiosRequestConfig,
  data: unknown,
): AxiosResponse => ({
  config,
  data,
  headers: {},
  status: 200,
  statusText: 'OK',
});

const requestError = (
  config: InternalAxiosRequestConfig,
  message: string,
) =>
  new AxiosError(message, 'BAD_REQUEST', config, undefined, {
    config,
    data: message,
    headers: {},
    status: 400,
    statusText: 'BAD_REQUEST',
  });

afterEach(() => {
  vi.useRealTimers();
});

describe('mutation hooks', () => {
  it('shares loading state between hook instances and direct actions', async () => {
    vi.useFakeTimers();
    let resolveRequest!: (value: AxiosResponse) => void;
    let requestConfig!: InternalAxiosRequestConfig;
    const h = makeHarness(
      (config) =>
        new Promise((resolve) => {
          requestConfig = config;
          resolveRequest = resolve;
        }),
    );
    const first = renderHook(() =>
      h.actions.useCreateEntity(USER, { isInterruptive: false }),
    );
    const second = renderHook(() =>
      h.actions.useCreateEntity(USER, { isInterruptive: false }),
    );

    let pending!: ReturnType<typeof h.actions.createEntity>;
    act(() => {
      pending = h.actions.createEntity(USER, { name: 'Ada' } as never, {
        isInterruptive: false,
      });
    });

    expect(first.result.current.requestKey).toBe('entity/user/create');
    expect(first.result.current.isLoading).toBe(true);
    expect(second.result.current.isLoading).toBe(true);

    resolveRequest(response(requestConfig, user('u1', 'Ada')));
    await act(async () => {
      await pending;
      await vi.advanceTimersByTimeAsync(LOADING_SETTLE_MS);
    });

    expect(first.result.current.isLoading).toBe(false);
    expect(second.result.current.isLoading).toBe(false);
  });

  it('sends concurrent hook mutations separately and stays loading until both settle', async () => {
    vi.useFakeTimers();
    const requests: Array<{
      config: InternalAxiosRequestConfig;
      resolve: (value: AxiosResponse) => void;
    }> = [];
    const h = makeHarness(
      (config) =>
        new Promise((resolve) => {
          requests.push({ config, resolve });
        }),
    );
    const hook = renderHook(() =>
      h.actions.useCreateEntity(USER, { isInterruptive: false }),
    );

    let first!: ReturnType<typeof hook.result.current.mutate>;
    let second!: ReturnType<typeof hook.result.current.mutate>;
    act(() => {
      first = hook.result.current.mutate({ name: 'Ada' } as never);
      second = hook.result.current.mutate({ name: 'Grace' } as never);
    });

    expect(requests).toHaveLength(2);
    expect(requests[0].config.requestKey).not.toBe(
      requests[1].config.requestKey,
    );
    expect(hook.result.current.isLoading).toBe(true);

    requests[0].resolve(response(requests[0].config, user('u1', 'Ada')));
    await act(async () => {
      await first;
      await vi.advanceTimersByTimeAsync(LOADING_SETTLE_MS);
    });
    expect(hook.result.current.isLoading).toBe(true);

    requests[1].resolve(response(requests[1].config, user('u2', 'Grace')));
    await act(async () => {
      await second;
      await vi.advanceTimersByTimeAsync(LOADING_SETTLE_MS);
    });
    expect(hook.result.current.isLoading).toBe(false);
  });

  it('deduplicates hook mutations that share an explicit request key', async () => {
    const h = makeHarness(async (config) =>
      response(config, user('u1', 'Ada')),
    );
    const hook = renderHook(() =>
      h.actions.useCreateEntity(USER, {
        isInterruptive: false,
        requestKey: 'create-user-once',
      }),
    );

    await act(async () => {
      await Promise.all([
        hook.result.current.mutate({ name: 'Ada' } as never),
        hook.result.current.mutate({ name: 'Ada' } as never),
      ]);
    });

    expect(h.adapter).toHaveBeenCalledTimes(1);
  });

  it('keeps mutate stable while using the latest hook options', async () => {
    const h = makeHarness(async (config) =>
      response(config, user('u1', 'Ada')),
    );
    const hook = renderHook(
      ({ success }: { success: string }) =>
        h.actions.useCreateEntity(USER, {
          isInterruptive: false,
          feedback: { loading: 'Creating user', success },
        }),
      { initialProps: { success: 'User created' } },
    );
    const mutate = hook.result.current.mutate;

    hook.rerender({ success: 'Ada created' });

    expect(hook.result.current.mutate).toBe(mutate);

    await act(async () => {
      await hook.result.current.mutate({ name: 'Ada' } as never);
    });

    const [config] = h.adapter.mock.calls[0];
    expect(config.feedback).toEqual({
      loading: 'Creating user',
      success: 'Ada created',
    });
  });

  it('keeps mutate stable when hook options use their default', () => {
    const h = makeHarness(async (config) =>
      response(config, user('u1', 'Ada')),
    );
    const hook = renderHook(() => h.actions.useCreateEntity(USER));
    const mutate = hook.result.current.mutate;

    hook.rerender();

    expect(hook.result.current.mutate).toBe(mutate);
  });

  it('exposes normalized errors and clears them explicitly', async () => {
    const h = makeHarness(async (config) => {
      throw requestError(config, 'Name is invalid');
    });
    const hook = renderHook(() =>
      h.actions.useCreateEntity(USER, { isInterruptive: false }),
    );

    await act(async () => {
      await hook.result.current.mutate({ name: '' } as never);
    });
    expect(hook.result.current.error).toEqual({
      code: 'BAD_REQUEST',
      message: 'Name is invalid',
      status: 400,
    });

    act(() => hook.result.current.clearError());
    expect(hook.result.current.error).toBeUndefined();
  });

  it('keeps the latest error across consecutive failures', async () => {
    let attempt = 0;
    const h = makeHarness(async (config) => {
      attempt += 1;
      throw requestError(config, `Failure ${attempt}`);
    });
    const hook = renderHook(() =>
      h.actions.useCreateEntity(USER, { isInterruptive: false }),
    );

    await act(async () => {
      await hook.result.current.mutate({ name: '' } as never);
    });
    expect(hook.result.current.error?.message).toBe('Failure 1');

    await act(async () => {
      await hook.result.current.mutate({ name: '' } as never);
    });
    expect(hook.result.current.error?.message).toBe('Failure 2');
  });

  it('does not clear shared errors when one observer unmounts', async () => {
    const h = makeHarness(async (config) => {
      throw requestError(config, 'Shared failure');
    });
    const first = renderHook(() =>
      h.actions.useCreateEntity(USER, { isInterruptive: false }),
    );
    const second = renderHook(() =>
      h.actions.useCreateEntity(USER, { isInterruptive: false }),
    );

    await act(async () => {
      await first.result.current.mutate({ name: '' } as never);
    });
    expect(second.result.current.error?.message).toBe('Shared failure');

    first.unmount();

    expect(second.result.current.error?.message).toBe('Shared failure');
  });

  it('tracks a transaction and each mutation contained in it', async () => {
    vi.useFakeTimers();
    let resolveRequest!: (value: AxiosResponse) => void;
    let requestConfig!: InternalAxiosRequestConfig;
    const h = makeHarness(
      (config) =>
        new Promise((resolve) => {
          requestConfig = config;
          resolveRequest = resolve;
        }),
    );
    const operations = [tx.createEntity(USER, { name: 'Ada' } as never)];
    const transaction = renderHook(() =>
      h.actions.useExecuteTransaction(operations, { isInterruptive: false }),
    );
    const create = renderHook(() =>
      h.actions.useCreateEntity(USER, { isInterruptive: false }),
    );

    let pending!: ReturnType<typeof transaction.result.current.mutate>;
    act(() => {
      pending = transaction.result.current.mutate();
    });

    expect(transaction.result.current.isLoading).toBe(true);
    expect(create.result.current.isLoading).toBe(true);

    resolveRequest(
      response(requestConfig, {
        results: [
          {
            operation: 'createEntity',
            ...user('u1', 'Ada'),
          },
        ],
      }),
    );
    await act(async () => {
      await pending;
      await vi.advanceTimersByTimeAsync(LOADING_SETTLE_MS);
    });

    expect(transaction.result.current.isLoading).toBe(false);
    expect(create.result.current.isLoading).toBe(false);
  });

  it('keeps transaction mutate stable and executes the latest operations', async () => {
    const h = makeHarness(async (config) =>
      response(config, {
        results: [{ operation: 'createEntity', ...user('u1', 'Grace') }],
      }),
    );
    const transaction = renderHook(
      ({ name }: { name: string }) =>
        h.actions.useExecuteTransaction([
          tx.createEntity(USER, { name } as never),
        ]),
      { initialProps: { name: 'Ada' } },
    );
    const mutate = transaction.result.current.mutate;

    transaction.rerender({ name: 'Grace' });

    expect(transaction.result.current.mutate).toBe(mutate);
    await act(async () => {
      await transaction.result.current.mutate();
    });

    const [config] = h.adapter.mock.calls[0];
    const body =
      typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
    expect(body.operations[0].payload).toEqual({ name: 'Grace' });
  });

  it('uses the target entity in a create-mutual hook key', () => {
    const h = makeHarness(async (config) => response(config, {}));
    const first = renderHook(() =>
      h.actions.useCreateMutual(USER, USER, 'u1', 'u2'),
    );
    const second = renderHook(() =>
      h.actions.useCreateMutual(USER, USER, 'u1', 'u3'),
    );

    expect(first.result.current.requestKey).toBe(
      'mutual/user/u1/user/u2/create',
    );
    expect(second.result.current.requestKey).toBe(
      'mutual/user/u1/user/u3/create',
    );
  });
});
