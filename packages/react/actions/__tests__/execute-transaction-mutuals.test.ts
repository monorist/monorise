import type { Entity } from '@monorise/base';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type TransactionOperation,
  type TransactionResultEntry,
  createTransactionCallRequestKey,
  getTransactionOperationRequestKey,
  transactional as tx,
} from '../../helpers/transactional';
import { getMutualRequestKey, getMutualStateKey } from '../../lib/utils';
import type { CoreService } from '../../services/core.service';
import { initMonoriseStore } from '../../store/monorise.store';
import type { ApplicationRequestError } from '../../types/api.type';
import type { Mutual } from '../../types/mutual.type';
import { initAppActions } from '../app.action';
import { initConfigActions } from '../config.action';
import { initCoreActions } from '../core.action';

// executeTransaction's createMutual / updateMutual / deleteMutual must leave
// the store exactly as the standalone createMutual / editMutual /
// deleteMutual actions do for the same server responses. Each case runs the
// standalone action in one store and the transaction in another, then
// compares them.

const USER = 'user' as unknown as Entity;
const TEAM = 'team' as unknown as Entity;
const T0 = '2026-10-27T00:00:00.000Z';
const T1 = '2026-10-27T01:00:00.000Z';

const entityConfig = {
  user: {
    name: 'user',
    displayName: 'User',
    mutual: { mutualFields: { teamIds: { entityType: TEAM } } },
  },
  team: {
    name: 'team',
    displayName: 'Team',
    mutual: { mutualFields: { userIds: { entityType: USER } } },
  },
} as never;

type Store = ReturnType<typeof initMonoriseStore>['monoriseStore'];

const makeHarness = () => {
  const { monoriseStore: store } = initMonoriseStore();
  const appActions = initAppActions(store);
  initConfigActions(store).setConfig(entityConfig);
  const mutualService = {
    createMutual: vi.fn(),
    editMutual: vi.fn(),
    deleteMutual: vi.fn(),
    getMutual: vi.fn(),
  };
  const entityService = {
    createEntity: vi.fn(),
    deleteEntity: vi.fn(),
  };
  const coreService = {
    makeEntityService: vi.fn(() => entityService),
    makeMutualService: vi.fn(() => mutualService),
    executeTransaction: vi.fn(),
  };
  const actions = initCoreActions(
    store,
    appActions,
    coreService as unknown as CoreService,
  );
  return {
    store,
    appActions,
    actions,
    mutualService,
    entityService,
    coreService,
  };
};

type Harness = ReturnType<typeof makeHarness>;

const entityRecord = (
  entityType: Entity,
  entityId: string,
  data: Record<string, unknown>,
) => ({ entityType, entityId, data, createdAt: T0, updatedAt: T0 });

const list = (entries: Mutual[] = [], isFirstFetched = true) => ({
  dataMap: new Map(entries.map((m) => [m.entityId, m])),
  isFirstFetched,
});

const userData = { u1: { name: 'Sam' }, u2: { name: 'Jo' } };
const teamData = {
  t1: { name: 'Kestrels', memberCount: 1 },
  t9: { name: 'Static', memberCount: 1 },
};

// What the server returns for a mutual: `data` is the target entity's data.
const serverMutual = (
  overrides: Partial<Mutual> & { byEntityId?: string; entityId?: string } = {},
): Mutual => {
  const byEntityId = overrides.byEntityId ?? 'u1';
  const entityId = overrides.entityId ?? 't1';
  return {
    byEntityType: USER,
    byEntityId,
    entityType: TEAM,
    entityId,
    mutualId: `m-${byEntityId}-${entityId}`,
    data: teamData[entityId as keyof typeof teamData] ?? {},
    mutualData: { role: 'MEMBER' },
    createdAt: T0,
    updatedAt: T0,
    mutualUpdatedAt: T0,
    ...overrides,
  } as Mutual;
};

// The reverse-side record a list keyed by the target holds.
const reversed = (m: Mutual): Mutual =>
  ({
    ...m,
    byEntityType: m.entityType,
    byEntityId: m.entityId,
    entityType: m.byEntityType,
    entityId: m.byEntityId,
    data: userData[m.byEntityId as keyof typeof userData] ?? {},
  }) as Mutual;

const entryFor = (
  operation: 'createMutual' | 'updateMutual' | 'deleteMutual',
  m: Mutual,
): TransactionResultEntry =>
  operation === 'deleteMutual'
    ? {
        operation,
        byEntityType: m.byEntityType,
        byEntityId: m.byEntityId,
        entityType: m.entityType,
        entityId: m.entityId,
        mutualId: m.mutualId,
      }
    : { operation, ...m };

const seed = (h: Harness, mutual: Record<string, ReturnType<typeof list>>) => {
  h.store.setState((state) => ({
    entity: {
      ...state.entity,
      [USER]: {
        ...state.entity[USER],
        dataMap: new Map(
          Object.entries(userData).map(([id, data]) => [
            id,
            entityRecord(USER, id, data),
          ]),
        ),
      },
      [TEAM]: {
        ...state.entity[TEAM],
        dataMap: new Map(
          Object.entries(teamData).map(([id, data]) => [
            id,
            entityRecord(TEAM, id, data),
          ]),
        ),
      },
    } as never,
    mutual: mutual as never,
  }));
};

const snapshot = (store: Store) =>
  Object.fromEntries(
    Object.entries(store.getState().mutual).map(([key, value]) => [
      key,
      { ...value, dataMap: Object.fromEntries(value.dataMap) },
    ]),
  );

const flushTimers = () => new Promise((resolve) => setTimeout(resolve, 0));

// endLoading clears a key 500 ms after the request settles (app.action.ts).
const LOADING_SETTLE_MS = 500;

const runTransaction = async (
  h: Harness,
  operations: TransactionOperation[],
  results: TransactionResultEntry[],
) => {
  h.coreService.executeTransaction.mockResolvedValue({ data: { results } });
  const outcome = await h.actions.executeTransaction(operations);
  await flushTimers();
  return outcome;
};

const fetchedLists = () => ({
  [getMutualStateKey(USER, 'u1', TEAM)]: list(),
  [getMutualStateKey(TEAM, 't1', USER)]: list(),
});

describe('executeTransaction mutual operations match the standalone actions', () => {
  it('createMutual updates both sides of fetched lists like createMutual', async () => {
    const m = serverMutual();
    const standalone = makeHarness();
    const transactional = makeHarness();
    seed(standalone, fetchedLists());
    seed(transactional, fetchedLists());

    standalone.mutualService.createMutual.mockResolvedValue({ data: m });
    await standalone.actions.createMutual(USER, TEAM, 'u1', 't1', {
      role: 'MEMBER',
    });
    const { error } = await runTransaction(
      transactional,
      [tx.createMutual(USER, TEAM, 'u1', 't1', { role: 'MEMBER' })],
      [entryFor('createMutual', m)],
    );

    expect(error).toBeUndefined();
    expect(snapshot(transactional.store)).toEqual(snapshot(standalone.store));
    const state = transactional.store.getState().mutual;
    expect(state['user/u1/team'].dataMap.get('t1')).toEqual(m);
    expect(state['team/t1/user'].dataMap.get('u1')).toEqual(reversed(m));
  });

  it('createMutual on lists never fetched creates them without marking them fetched', async () => {
    const m = serverMutual();
    const standalone = makeHarness();
    const transactional = makeHarness();
    seed(standalone, {});
    seed(transactional, {});

    standalone.mutualService.createMutual.mockResolvedValue({ data: m });
    await standalone.actions.createMutual(USER, TEAM, 'u1', 't1', {
      role: 'MEMBER',
    });
    await runTransaction(
      transactional,
      [tx.createMutual(USER, TEAM, 'u1', 't1', { role: 'MEMBER' })],
      [entryFor('createMutual', m)],
    );

    expect(snapshot(transactional.store)).toEqual(snapshot(standalone.store));
    // Not marked fetched, so the first useMutuals mount still loads the list.
    expect(
      transactional.store.getState().mutual['user/u1/team'].isFirstFetched,
    ).toBeUndefined();
  });

  it('updateMutual updates both sides like editMutual', async () => {
    const before = serverMutual();
    const after = serverMutual({
      mutualData: { role: 'CAPTAIN' },
      mutualUpdatedAt: T1,
    });
    const lists = () => ({
      'user/u1/team': list([before]),
      'team/t1/user': list([reversed(before)]),
    });
    const standalone = makeHarness();
    const transactional = makeHarness();
    seed(standalone, lists());
    seed(transactional, lists());

    standalone.mutualService.editMutual.mockResolvedValue({ data: after });
    await standalone.actions.editMutual(USER, TEAM, 'u1', 't1', {
      role: 'CAPTAIN',
    });
    await runTransaction(
      transactional,
      [tx.updateMutual(USER, TEAM, 'u1', 't1', { role: 'CAPTAIN' })],
      [entryFor('updateMutual', after)],
    );

    expect(snapshot(transactional.store)).toEqual(snapshot(standalone.store));
    const state = transactional.store.getState().mutual;
    expect(state['user/u1/team'].dataMap.get('t1')?.mutualData).toEqual({
      role: 'CAPTAIN',
    });
    expect(state['team/t1/user'].dataMap.get('u1')?.mutualData).toEqual({
      role: 'CAPTAIN',
    });
  });

  it('updateMutual whose post-commit read failed leaves the cache as it was', async () => {
    const before = serverMutual();
    const h = makeHarness();
    seed(h, {
      'user/u1/team': list([before]),
      'team/t1/user': list([reversed(before)]),
    });
    const prior = snapshot(h.store);

    await runTransaction(
      h,
      [tx.updateMutual(USER, TEAM, 'u1', 't1', { role: 'CAPTAIN' })],
      [
        {
          operation: 'updateMutual',
          byEntityType: USER,
          byEntityId: 'u1',
          entityType: TEAM,
          entityId: 't1',
          mutualId: before.mutualId,
        },
      ],
    );

    expect(snapshot(h.store)).toEqual(prior);
  });

  it('deleteMutual removes both sides like deleteMutual', async () => {
    const m = serverMutual();
    const lists = () => ({
      'user/u1/team': list([m]),
      'team/t1/user': list([reversed(m)]),
    });
    const standalone = makeHarness();
    const transactional = makeHarness();
    seed(standalone, lists());
    seed(transactional, lists());

    standalone.mutualService.deleteMutual.mockResolvedValue({ data: m });
    await standalone.actions.deleteMutual(USER, TEAM, 'u1', 't1');
    await runTransaction(
      transactional,
      [tx.deleteMutual(USER, TEAM, 'u1', 't1')],
      [entryFor('deleteMutual', m)],
    );

    expect(snapshot(transactional.store)).toEqual(snapshot(standalone.store));
    const state = transactional.store.getState().mutual;
    expect(state['user/u1/team'].dataMap.has('t1')).toBe(false);
    expect(state['team/t1/user'].dataMap.has('u1')).toBe(false);
  });

  it('deleteMutual on lists never fetched succeeds without creating them', async () => {
    const m = serverMutual();
    const standalone = makeHarness();
    const transactional = makeHarness();
    seed(standalone, {});
    seed(transactional, {});

    standalone.mutualService.deleteMutual.mockResolvedValue({ data: m });
    const standaloneResult = await standalone.actions.deleteMutual(
      USER,
      TEAM,
      'u1',
      't1',
    );
    const transactionResult = await runTransaction(
      transactional,
      [tx.deleteMutual(USER, TEAM, 'u1', 't1')],
      [entryFor('deleteMutual', m)],
    );

    // The delete succeeded on the server, so neither reports a failure.
    expect(standaloneResult.error).toBeUndefined();
    expect(transactionResult.error).toBeUndefined();
    expect(snapshot(transactional.store)).toEqual({});
    expect(snapshot(standalone.store)).toEqual({});
  });

  it('single-mutual reads (useMutual / getMutual) see transactional changes', async () => {
    const m = serverMutual();
    const h = makeHarness();
    seed(h, fetchedLists());

    await runTransaction(
      h,
      [tx.createMutual(USER, TEAM, 'u1', 't1', { role: 'MEMBER' })],
      [entryFor('createMutual', m)],
    );
    // useMutual reads the pair from the list keyed without the target id.
    const { data } = await h.actions.getMutual(USER, TEAM, 'u1', 't1');
    expect(data).toEqual(m);
    expect(h.mutualService.getMutual).not.toHaveBeenCalled();

    await runTransaction(
      h,
      [tx.deleteMutual(USER, TEAM, 'u1', 't1')],
      [entryFor('deleteMutual', m)],
    );
    expect(
      h.store
        .getState()
        .mutual[getMutualStateKey(USER, 'u1', TEAM)].dataMap.get('t1'),
    ).toBeUndefined();
  });

  it('leaves chain-query lists alone, as the standalone actions do', async () => {
    const m = serverMutual();
    const chainKey = getMutualStateKey(USER, 'u1', TEAM, undefined, 'grade');
    const lists = () => ({ ...fetchedLists(), [chainKey]: list() });
    const standalone = makeHarness();
    const transactional = makeHarness();
    seed(standalone, lists());
    seed(transactional, lists());

    standalone.mutualService.createMutual.mockResolvedValue({ data: m });
    await standalone.actions.createMutual(USER, TEAM, 'u1', 't1', {
      role: 'MEMBER',
    });
    await runTransaction(
      transactional,
      [tx.createMutual(USER, TEAM, 'u1', 't1', { role: 'MEMBER' })],
      [entryFor('createMutual', m)],
    );

    expect(snapshot(transactional.store)).toEqual(snapshot(standalone.store));
    expect(transactional.store.getState().mutual[chainKey].dataMap.size).toBe(
      0,
    );
  });

  it('replaces list Maps instead of mutating them, so subscribers re-render', async () => {
    const m = serverMutual();
    const h = makeHarness();
    seed(h, fetchedLists());
    const listener = vi.fn();
    h.store.subscribe(listener);

    const beforeCreate = h.store.getState().mutual['user/u1/team'].dataMap;
    await runTransaction(
      h,
      [tx.createMutual(USER, TEAM, 'u1', 't1', { role: 'MEMBER' })],
      [entryFor('createMutual', m)],
    );
    const afterCreate = h.store.getState().mutual['user/u1/team'].dataMap;
    expect(afterCreate).not.toBe(beforeCreate);
    expect(beforeCreate.size).toBe(0);

    const updated = serverMutual({ mutualData: { role: 'CAPTAIN' } });
    await runTransaction(
      h,
      [tx.updateMutual(USER, TEAM, 'u1', 't1', { role: 'CAPTAIN' })],
      [entryFor('updateMutual', updated)],
    );
    const afterUpdate = h.store.getState().mutual['user/u1/team'].dataMap;
    expect(afterUpdate).not.toBe(afterCreate);
    expect(afterCreate.get('t1')?.mutualData).toEqual({ role: 'MEMBER' });

    await runTransaction(
      h,
      [tx.deleteMutual(USER, TEAM, 'u1', 't1')],
      [entryFor('deleteMutual', updated)],
    );
    const afterDelete = h.store.getState().mutual['user/u1/team'].dataMap;
    expect(afterDelete).not.toBe(afterUpdate);
    expect(afterUpdate.has('t1')).toBe(true);
    expect(listener).toHaveBeenCalled();
  });
});

describe('executeTransaction mutual request keys', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('drives the standalone actions’ loading keys while pending, then clears them', async () => {
    vi.useFakeTimers();
    const h = makeHarness();
    seed(h, fetchedLists());
    let resolve!: (value: unknown) => void;
    h.coreService.executeTransaction.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const operations = [
      tx.createMutual(USER, TEAM, 'u1', 't1', { role: 'MEMBER' }),
      tx.updateMutual(USER, TEAM, 'u1', 't9', { role: 'CAPTAIN' }),
      tx.deleteMutual(USER, TEAM, 'u2', 't9'),
    ];
    const keys = [
      getMutualRequestKey('create', USER, TEAM, 'u1', 't1'),
      getMutualRequestKey('update', USER, TEAM, 'u1', 't9'),
      getMutualRequestKey('delete', USER, TEAM, 'u2', 't9'),
    ];
    expect(operations.map(getTransactionOperationRequestKey)).toEqual(keys);

    const pending = h.actions.executeTransaction(operations);
    expect(keys.map((k) => h.appActions.checkIsLoading(k))).toEqual([
      true,
      true,
      true,
    ]);

    resolve({
      data: {
        results: [
          entryFor('createMutual', serverMutual()),
          entryFor(
            'updateMutual',
            serverMutual({ entityId: 't9', mutualData: { role: 'CAPTAIN' } }),
          ),
          entryFor(
            'deleteMutual',
            serverMutual({ byEntityId: 'u2', entityId: 't9' }),
          ),
        ],
      },
    });
    await pending;
    await vi.advanceTimersByTimeAsync(LOADING_SETTLE_MS);
    expect(keys.map((k) => h.appActions.checkIsLoading(k))).toEqual([
      false,
      false,
      false,
    ]);
    expect(keys.map((k) => h.appActions.getError(k))).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('puts the call’s error on every mutual op’s key when the transaction fails', async () => {
    vi.useFakeTimers();
    const h = makeHarness();
    seed(h, fetchedLists());
    const appError: ApplicationRequestError = {
      status: 409,
      code: 'TRANSACTION_FAILED',
      message: 'Transaction failed',
    };
    let generatedCallRequestKey = '';
    // Stand in for lib/api.ts's interceptor, which records the call's error
    // under its own request key before rejecting.
    h.coreService.executeTransaction.mockImplementation(
      (_ops: unknown, opts: { requestKey: string }) => {
        generatedCallRequestKey = opts.requestKey;
        h.appActions.setError({ requestKey: opts.requestKey, error: appError });
        return Promise.reject(new Error('Transaction failed'));
      },
    );
    const keys = [
      getMutualRequestKey('create', USER, TEAM, 'u1', 't1'),
      getMutualRequestKey('delete', USER, TEAM, 'u2', 't9'),
    ];
    const prior = snapshot(h.store);

    const { error } = await h.actions.executeTransaction([
      tx.createMutual(USER, TEAM, 'u1', 't1', { role: 'MEMBER' }),
      tx.deleteMutual(USER, TEAM, 'u2', 't9'),
    ]);
    await vi.advanceTimersByTimeAsync(LOADING_SETTLE_MS);

    expect(error).toBeInstanceOf(Error);
    expect(keys.map((k) => h.appActions.getError(k))).toEqual([
      appError,
      appError,
    ]);
    expect(keys.map((k) => h.appActions.checkIsLoading(k))).toEqual([
      false,
      false,
    ]);
    expect(h.appActions.getError(generatedCallRequestKey)).toBeUndefined();
    expect(snapshot(h.store)).toEqual(prior);
  });

  it('retains a call error stored under an explicit request key', async () => {
    const h = makeHarness();
    seed(h, fetchedLists());
    const appError: ApplicationRequestError = {
      status: 409,
      code: 'TRANSACTION_FAILED',
      message: 'Transaction failed',
    };
    const requestKey = 'transaction/intentional-dedupe';
    h.coreService.executeTransaction.mockImplementation(
      (_ops: unknown, opts: { requestKey: string }) => {
        h.appActions.setError({ requestKey: opts.requestKey, error: appError });
        return Promise.reject(new Error('Transaction failed'));
      },
    );

    await h.actions.executeTransaction(
      [tx.deleteMutual(USER, TEAM, 'u1', 't1')],
      { requestKey },
    );

    expect(h.appActions.getError(requestKey)).toEqual(appError);
  });

  it('gives every transaction call a unique, descriptive key', () => {
    const toT1 = [tx.createMutual(USER, TEAM, 'u1', 't1')];
    const toT9 = [tx.createMutual(USER, TEAM, 'u1', 't9')];
    const t1Key = createTransactionCallRequestKey(toT1);
    const repeatedT1Key = createTransactionCallRequestKey([
      tx.createMutual(USER, TEAM, 'u1', 't1'),
    ]);
    const t9Key = createTransactionCallRequestKey(toT9);

    // Transactions are non-idempotent, so even identical batches must not
    // dedupe unless the caller explicitly supplies opts.requestKey.
    expect(t1Key).not.toBe(repeatedT1Key);
    expect(t1Key).not.toBe(t9Key);

    // Preserve the target id in the descriptive segment added with
    // transactional mutual operations; the nonce is appended after it.
    expect(t1Key).toMatch(
      /^transaction\/mutual\/user\/u1\/team\/t1\/create#.+/,
    );
    expect(t9Key).toMatch(
      /^transaction\/mutual\/user\/u1\/team\/t9\/create#.+/,
    );
  });
});

describe('executeTransaction mutual operations alongside entity operations', () => {
  it('createEntity with mutual-field ids and createMutual in one transaction', async () => {
    const created = entityRecord(TEAM, 't3', { name: 'Halo' });
    const link = serverMutual({ byEntityId: 'u2', entityId: 't1' });
    const lists = () => ({
      'user/u1/team': list(),
      'team/t1/user': list(),
    });
    const standalone = makeHarness();
    const transactional = makeHarness();
    seed(standalone, lists());
    seed(transactional, lists());

    standalone.entityService.createEntity.mockResolvedValue({ data: created });
    standalone.mutualService.createMutual.mockResolvedValue({ data: link });
    await standalone.actions.createEntity(TEAM, {
      name: 'Halo',
      userIds: ['u1'],
    } as never);
    await standalone.actions.createMutual(USER, TEAM, 'u2', 't1', {
      role: 'MEMBER',
    });
    await runTransaction(
      transactional,
      [
        tx.createEntity(TEAM, { name: 'Halo', userIds: ['u1'] } as never),
        tx.createMutual(USER, TEAM, 'u2', 't1', { role: 'MEMBER' }),
      ],
      [
        { operation: 'createEntity', ...created },
        entryFor('createMutual', link),
      ],
    );

    expect(snapshot(transactional.store)).toEqual(snapshot(standalone.store));
    const state = transactional.store.getState().mutual;
    expect(state['user/u1/team'].dataMap.has('t3')).toBe(true);
    expect(state['team/t1/user'].dataMap.get('u2')?.data).toEqual(userData.u2);
  });

  it('deleteEntity and deleteMutual in one transaction', async () => {
    const t1Link = serverMutual();
    const t9Link = serverMutual({ byEntityId: 'u2', entityId: 't9' });
    const lists = () => ({
      'user/u1/team': list([t1Link]),
      'team/t1/user': list([reversed(t1Link)]),
      'user/u2/team': list([t9Link]),
      'team/t9/user': list([reversed(t9Link)]),
    });
    const standalone = makeHarness();
    const transactional = makeHarness();
    seed(standalone, lists());
    seed(transactional, lists());

    standalone.entityService.deleteEntity.mockResolvedValue({});
    standalone.mutualService.deleteMutual.mockResolvedValue({ data: t9Link });
    await standalone.actions.deleteEntity(TEAM, 't1');
    await standalone.actions.deleteMutual(USER, TEAM, 'u2', 't9');
    await runTransaction(
      transactional,
      [tx.deleteEntity(TEAM, 't1'), tx.deleteMutual(USER, TEAM, 'u2', 't9')],
      [
        { operation: 'deleteEntity', entityType: TEAM, entityId: 't1' },
        entryFor('deleteMutual', t9Link),
      ],
    );

    expect(snapshot(transactional.store)).toEqual(snapshot(standalone.store));
    const state = transactional.store.getState().mutual;
    expect(state['user/u1/team'].dataMap.has('t1')).toBe(false);
    expect(state['user/u2/team'].dataMap.has('t9')).toBe(false);
    expect(state['team/t9/user'].dataMap.has('u2')).toBe(false);
  });

  it('a link and an update to its target end with the committed data whatever the order', async () => {
    const fresh = { name: 'Kestrels', memberCount: 2 };
    // The server overlays the committed entity data onto the mutual entry.
    const link = serverMutual({ data: fresh as never });
    const updated = { ...entityRecord(TEAM, 't1', fresh), updatedAt: T1 };
    const outcomes = [];

    for (const order of ['link-first', 'update-first'] as const) {
      const h = makeHarness();
      seed(h, fetchedLists());
      const linkOp = tx.createMutual(USER, TEAM, 'u1', 't1', {
        role: 'MEMBER',
      });
      const updateOp = tx.adjustEntity(TEAM, 't1', { memberCount: 1 });
      const linkEntry = entryFor('createMutual', link);
      const updateEntry: TransactionResultEntry = {
        operation: 'adjustEntity',
        entityType: TEAM,
        entityId: 't1',
        data: fresh,
        updatedAt: T1,
      };
      await runTransaction(
        h,
        order === 'link-first' ? [linkOp, updateOp] : [updateOp, linkOp],
        order === 'link-first'
          ? [linkEntry, updateEntry]
          : [updateEntry, linkEntry],
      );
      outcomes.push(snapshot(h.store));
      expect(
        h.store.getState().mutual['user/u1/team'].dataMap.get('t1')?.data,
      ).toEqual(fresh);
      expect(h.store.getState().entity[TEAM].dataMap.get('t1')).toEqual(
        updated,
      );
    }

    expect(outcomes[0]).toEqual(outcomes[1]);
  });
});
