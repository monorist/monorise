// @vitest-environment happy-dom

import type { Entity } from '@monorise/base';
import { act, renderHook } from '@testing-library/react';
import {
  AxiosError,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { produce } from 'immer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initAxiosInterceptor, injectAxiosInterceptor } from '../../lib/api';
import initCoreService from '../../services/core.service';
import { initMonoriseStore } from '../../store/monorise.store';
import { initAppActions } from '../app.action';
import type { AuthActions } from '../auth.action';
import { initConfigActions } from '../config.action';
import { initCoreActions } from '../core.action';

// USER uses the word index; TEAM still scans with `searchableFields`.
const USER = 'user' as unknown as Entity;
const TEAM = 'team' as unknown as Entity;
const T0 = '2026-11-08T00:00:00.000Z';
const T1 = '2026-11-08T00:01:00.000Z';
const SEARCH_INTERVAL = 10;

const entity = (
  entityType: Entity,
  entityId: string,
  name: string,
  updatedAt = T0,
) => ({
  entityType,
  entityId,
  data: { name },
  createdAt: T0,
  updatedAt,
});

type Pending = {
  config: InternalAxiosRequestConfig;
  resolve: (value: AxiosResponse) => void;
  reject: (reason: unknown) => void;
};

const makeHarness = () => {
  const { monoriseStore: store } = initMonoriseStore();
  const appActions = initAppActions(store);
  const axios = initAxiosInterceptor(store, appActions);
  const requests: Pending[] = [];
  axios.defaults.adapter = vi.fn(
    (config: InternalAxiosRequestConfig) =>
      new Promise<AxiosResponse>((resolve, reject) => {
        requests.push({ config, resolve, reject });
      }),
  );
  injectAxiosInterceptor(
    appActions,
    { setIsUnauthorized: vi.fn() } as unknown as AuthActions,
    axios,
  );
  initConfigActions(store).setConfig({
    user: {
      name: 'user',
      displayName: 'User',
      search: { fields: [{ field: 'name' }] },
    },
    team: { name: 'team', displayName: 'Team', searchableFields: ['name'] },
  } as never);
  const actions = initCoreActions(
    store,
    appActions,
    initCoreService(store, axios),
  );

  // Both types start listed, so the hooks don't fetch the list.
  store.setState(
    produce((state) => {
      state.entity[USER].isFirstFetched = true;
      state.entity[TEAM].isFirstFetched = true;
    }),
  );

  const settle = () =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(SEARCH_INTERVAL);
    });
  const reply = async (request: Pending, data: unknown) => {
    request.resolve({
      config: request.config,
      data,
      headers: {},
      status: 200,
      statusText: 'OK',
    });
    await settle();
  };
  const searches = () =>
    requests.filter((request) => request.config.params?.query !== undefined);
  const last = () => requests[requests.length - 1];

  const render = (entityType: Entity) => {
    const hook = renderHook(() =>
      actions.useEntities(entityType, {}, { searchInterval: SEARCH_INTERVAL }),
    );
    const type = async (value: string) => {
      act(() => {
        hook.result.current.searchField.onChange({
          target: { value },
        } as React.ChangeEvent<HTMLInputElement>);
      });
      await settle();
    };
    const names = () => hook.result.current.entities?.map((e) => e.data.name);
    return { hook, type, names };
  };

  return { store, actions, searches, reply, last, render };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useEntities search', () => {
  it('sends each query on its own, and shows only the latest one', async () => {
    const h = makeHarness();
    const { type, names } = h.render(USER);

    await type('jo');
    await type('john');
    const [jo, john] = h.searches();

    expect(h.searches()).toHaveLength(2);
    expect(john.config.params).toEqual({ query: 'john' });

    await h.reply(john, { data: [entity(USER, '01B', 'John')] });
    await h.reply(jo, {
      data: [entity(USER, '01A', 'Joanna'), entity(USER, '01B', 'John')],
    });

    expect(names()).toEqual(['John']);
  });

  it('shows the list until the query has a word to look up', async () => {
    const h = makeHarness();
    h.store.setState(
      produce((state) => {
        state.entity[USER].dataMap.set('01A', entity(USER, '01A', 'John'));
      }),
    );
    const { hook, type, names } = h.render(USER);

    await type('j');
    expect(h.searches()).toHaveLength(0);
    expect(hook.result.current.isLoading).toBe(false);
    expect(names()).toEqual(['John']);

    await type('jo');
    expect(h.searches()).toHaveLength(1);
    expect(hook.result.current.isLoading).toBe(true);
  });

  it('still sends one letter for a scanned type', async () => {
    const h = makeHarness();
    const { type } = h.render(TEAM);

    await type('r');

    expect(h.searches()).toHaveLength(1);
  });

  it('keeps a newer cached entity over an older result', async () => {
    const h = makeHarness();
    h.store.setState(
      produce((state) => {
        state.entity[USER].dataMap.set(
          '01A',
          entity(USER, '01A', 'John Smith', T1),
        );
        state.entity[USER].dataMap.set(
          '01B',
          entity(USER, '01B', 'Jane Roe', T1),
        );
      }),
    );
    const { type, names } = h.render(USER);

    await type('john');
    await h.reply(h.searches()[0], {
      data: [
        entity(USER, '01A', 'John Doe'),
        // renamed away from "john" on this client, not yet in the index
        entity(USER, '01B', 'John Roe'),
      ],
    });

    // The server decides what matches; the client only keeps its data fresh.
    expect(names()).toEqual(['John Smith', 'Jane Roe']);
    const { dataMap } = h.store.getState().entity[USER];
    expect(dataMap.get('01A')?.data.name).toBe('John Smith');
    expect(dataMap.get('01B')?.data.name).toBe('Jane Roe');
  });

  it('updates results in place and removes deleted ones, without adding', async () => {
    const h = makeHarness();
    const { type, names } = h.render(USER);
    await type('john');
    await h.reply(h.searches()[0], {
      data: [entity(USER, '01C', 'John C'), entity(USER, '01A', 'John A')],
    });

    const create = h.actions.createEntity(USER, { name: 'John B' } as never);
    await h.reply(h.last(), entity(USER, '01B', 'John B'));
    await act(() => create);
    expect(names()).toEqual(['John C', 'John A']);

    const edit = h.actions.editEntity(USER, '01C', { name: 'Jane C' } as never);
    await h.reply(h.last(), entity(USER, '01C', 'Jane C', T1));
    await act(() => edit);
    expect(names()).toEqual(['Jane C', 'John A']);

    const remove = h.actions.deleteEntity(USER, '01A');
    await h.reply(h.last(), {});
    await act(() => remove);
    expect(names()).toEqual(['Jane C']);
  });

  it('does the same for a scanned type', async () => {
    const h = makeHarness();
    const { type, names } = h.render(TEAM);
    await type('red');
    await h.reply(h.searches()[0], { data: [entity(TEAM, '01A', 'Red Team')] });

    const create = h.actions.createEntity(TEAM, { name: 'Red Two' } as never);
    await h.reply(h.last(), entity(TEAM, '01B', 'Red Two'));
    await act(() => create);
    const edit = h.actions.editEntity(TEAM, '01A', {
      name: 'Blue Team',
    } as never);
    await h.reply(h.last(), entity(TEAM, '01A', 'Blue Team', T1));
    await act(() => edit);

    expect(names()).toEqual(['Blue Team']);
  });

  it('searches again after a failed search', async () => {
    const h = makeHarness();
    const { hook, type } = h.render(USER);
    await type('john');
    const [failed] = h.searches();
    failed.reject(
      new AxiosError('Network Error', 'ERR_NETWORK', failed.config),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SEARCH_INTERVAL);
    });

    act(() => {
      void hook.result.current.refetch();
    });

    expect(h.searches()).toHaveLength(2);
  });
});
