import type { Entity } from '@monorise/base';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getMutualStateKey, getTagStateKey } from '../../lib/utils';
import type { CoreService } from '../../services/core.service';
import { initMonoriseStore } from '../../store/monorise.store';
import type { Mutual } from '../../types/mutual.type';
import { initAppActions } from '../app.action';
import { initConfigActions } from '../config.action';
import { initCoreActions } from '../core.action';

// useEntities, useMutuals and useTaggedEntities must return the store's data
// in the same render that reports it loaded (`isFirstFetched`). Each hook is
// rendered once with react-dom/server, where effects never run: an array
// copied over from the store in an effect would still be empty.

const USER = 'user' as unknown as Entity;
const TEAM = 'team' as unknown as Entity;
const T0 = '2026-10-27T00:00:00.000Z';

const config = {
  user: { name: 'user', displayName: 'User' },
  team: {
    name: 'team',
    displayName: 'Team',
    tags: [
      {
        name: 'by-region',
        processor: (team: { data: { region: string; rank: string } }) => [
          { group: team.data.region, sortValue: team.data.rank },
        ],
      },
    ],
  },
} as never;

const team = (entityId: string, region: string, rank: string) => ({
  entityType: TEAM,
  entityId,
  data: { region, rank },
  createdAt: T0,
  updatedAt: T0,
});

const membership = (entityId: string) =>
  ({
    byEntityType: USER,
    byEntityId: 'u1',
    entityType: TEAM,
    entityId,
    mutualId: `m-${entityId}`,
    data: {},
    mutualData: {},
    createdAt: T0,
    updatedAt: T0,
    mutualUpdatedAt: T0,
  }) as Mutual;

const makeHarness = () => {
  const { monoriseStore: store } = initMonoriseStore();
  initConfigActions(store).setConfig(config);
  const actions = initCoreActions(
    store,
    initAppActions(store),
    {} as CoreService,
  );
  return { store, actions };
};

type Store = ReturnType<typeof makeHarness>['store'];
type State = ReturnType<Store['getState']>;

/**
 * Seeds the store. On the server, zustand renders the store's initial state
 * (its server snapshot), so the seed goes there too.
 */
function seed(store: Store, update: (state: State) => Partial<State>) {
  store.setState(update);
  Object.assign(store.getInitialState(), store.getState());
}

/** What a hook returns on its first render, before any effect could run. */
function firstRender<R>(hook: () => R): R {
  let result: R | undefined;
  const Probe = () => {
    result = hook();
    return null;
  };
  renderToString(createElement(Probe));
  return result as R;
}

describe('hook arrays on the render that reports them loaded', () => {
  it('useMutuals returns the loaded mutuals', () => {
    const { store, actions } = makeHarness();
    seed(store, (state) => ({
      mutual: {
        ...state.mutual,
        [getMutualStateKey(USER, 'u1', TEAM)]: {
          dataMap: new Map([
            ['t1', membership('t1')],
            ['t2', membership('t2')],
          ]),
          isFirstFetched: true,
        },
      } as never,
    }));

    const { mutuals, isFirstFetched } = firstRender(() =>
      actions.useMutuals(USER, TEAM, 'u1'),
    );

    expect(isFirstFetched).toBe(true);
    expect(mutuals.map((m) => m.entityId)).toEqual(['t1', 't2']);
  });

  it('useTaggedEntities returns the loaded entities, ordered like the server', () => {
    const { store, actions } = makeHarness();
    const params = { group: 'north' };
    seed(store, (state) => ({
      tag: {
        ...state.tag,
        [getTagStateKey(TEAM, 'by-region', params)]: {
          dataMap: new Map([
            ['t1', team('t1', 'north', '1')],
            ['t2', team('t2', 'north', '3')],
            ['t3', team('t3', 'north', '2')],
          ]),
          isFirstFetched: true,
        },
      } as never,
    }));

    const { entities, isFirstFetched } = firstRender(() =>
      actions.useTaggedEntities(TEAM, 'by-region', { params }),
    );

    expect(isFirstFetched).toBe(true);
    // Descending by sort value, as the server queries tags.
    expect(entities.map((e) => e.entityId)).toEqual(['t2', 't3', 't1']);
  });

  it('useEntities returns the loaded entities, newest id first', () => {
    const { store, actions } = makeHarness();
    seed(store, (state) => ({
      entity: {
        ...state.entity,
        [TEAM]: {
          ...state.entity[TEAM],
          dataMap: new Map([
            ['t2', team('t2', 'north', '1')],
            ['t1', team('t1', 'south', '1')],
          ]),
          isFirstFetched: true,
        },
      } as never,
    }));

    const { entities, isFirstFetched } = firstRender(() =>
      actions.useEntities(TEAM),
    );

    expect(isFirstFetched).toBe(true);
    expect(entities?.map((e) => e.entityId)).toEqual(['t2', 't1']);
  });

  it('returns empty arrays, not undefined, before anything is loaded', () => {
    const { actions } = makeHarness();

    const result = firstRender(() => ({
      mutuals: actions.useMutuals(USER, TEAM, 'u1').mutuals,
      tagged: actions.useTaggedEntities(TEAM, 'by-region', {
        params: { group: 'north' },
      }).entities,
      // Was `undefined` until the hook's first effect ran.
      entities: actions.useEntities(TEAM).entities,
    }));

    expect(result).toEqual({ mutuals: [], tagged: [], entities: [] });
  });
});
