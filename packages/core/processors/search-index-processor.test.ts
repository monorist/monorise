import type {
  BatchWriteItemCommandInput,
  DynamoDB,
} from '@aws-sdk/client-dynamodb';
import type { _Record as DynamoDBStreamEvent } from '@aws-sdk/client-dynamodb-streams';
import { marshall } from '@aws-sdk/util-dynamodb';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  createEntityConfig,
  resolveSearchConfig,
  searchConfigHash,
} from '../../base';
import type { Entity as EntityType } from '../../base';
import { Entity, type EntityRepository } from '../data/Entity';
import { SearchRepository } from '../data/Search';
import type { DependencyContainer } from '../services/DependencyContainer';
import {
  type SearchReindexEvent,
  handler,
  syncSearchIndex,
} from './search-index-processor';

const USER = 'user' as unknown as EntityType;
const PRODUCT = 'product' as unknown as EntityType;

const entityConfig = {
  [USER]: createEntityConfig({
    name: USER,
    displayName: 'User',
    baseSchema: z
      .object({ name: z.string(), email: z.string(), age: z.number() })
      .partial(),
    search: { fields: [{ field: 'name' }, { field: 'email' }] },
  }),
  [PRODUCT]: createEntityConfig({
    name: PRODUCT,
    displayName: 'Product',
    baseSchema: z.object({ name: z.string() }).partial(),
    search: { fields: [{ field: 'name' }] },
  }),
  admin: createEntityConfig({
    name: 'admin' as unknown as EntityType,
    displayName: 'Admin',
    baseSchema: z.object({ name: z.string() }).partial(),
    searchableFields: ['name'],
  }),
} as unknown as ConstructorParameters<typeof SearchRepository>[0];

const createSearchRepository = () => {
  const batchWriteItem = vi.fn(async (_: BatchWriteItemCommandInput) => ({}));
  const repository = new SearchRepository(
    entityConfig,
    'table',
    { batchWriteItem } as unknown as DynamoDB,
    {} as EntityRepository,
  );
  const writes = () =>
    batchWriteItem.mock.calls.flatMap(
      ([input]) => input.RequestItems?.table ?? [],
    );
  return { repository, batchWriteItem, writes };
};

const metadataImage = (
  entityType: string,
  entityId: string,
  data: Record<string, unknown>,
  updatedAt = '2026-11-08T00:00:00.000Z',
) => ({
  ...marshall({ entityType, entityId, data, createdAt: updatedAt, updatedAt }),
  PK: { S: `${entityType}#${entityId}` },
  SK: { S: '#METADATA#' },
});

const streamRecord = (
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE',
  images: { OldImage?: object; NewImage?: object },
) => ({ eventName, dynamodb: images }) as unknown as DynamoDBStreamEvent;

describe('syncSearchIndex', () => {
  it('writes a copy of the entity for each indexed word on insert', async () => {
    const { repository, writes } = createSearchRepository();
    const NewImage = metadataImage('user', '01A', {
      name: 'John Doe',
      email: 'john.doe@mail.com',
    });

    await syncSearchIndex(
      { searchRepository: repository } as unknown as DependencyContainer,
      streamRecord('INSERT', { NewImage }),
    );

    const puts = writes().map((w) => w.PutRequest?.Item);
    expect(puts.map((item) => item?.SK.S)).toEqual([
      'john#01A',
      'doe#01A',
      'mail#01A',
      'com#01A',
    ]);
    expect(puts[0]).toMatchObject({
      PK: { S: 'SEARCH#user' },
      R1PK: { S: 'user#01A' },
      R1SK: { S: 'SEARCH#john' },
      entityId: { S: '01A' },
      updatedAt: { S: '2026-11-08T00:00:00.000Z' },
      data: { M: { name: { S: 'John Doe' } } },
    });
  });

  it('writes only the words that came and went on modify', async () => {
    const { repository, writes } = createSearchRepository();
    const email = 'jd@mail.com';

    await syncSearchIndex(
      { searchRepository: repository } as unknown as DependencyContainer,
      streamRecord('MODIFY', {
        OldImage: metadataImage('user', '01A', { name: 'John Doe', email }),
        NewImage: metadataImage('user', '01A', { name: 'John Smith', email }),
      }),
    );

    expect(writes()).toEqual([
      expect.objectContaining({
        PutRequest: {
          Item: expect.objectContaining({ SK: { S: 'smith#01A' } }),
        },
      }),
      {
        DeleteRequest: {
          Key: { PK: { S: 'SEARCH#user' }, SK: { S: 'doe#01A' } },
        },
      },
    ]);
  });

  it('writes nothing when no searchable field changed', async () => {
    const { repository, batchWriteItem } = createSearchRepository();
    const data = { name: 'John Doe', email: 'john.doe@mail.com' };

    await syncSearchIndex(
      { searchRepository: repository } as unknown as DependencyContainer,
      streamRecord('MODIFY', {
        OldImage: metadataImage('user', '01A', { ...data, age: 30 }),
        NewImage: metadataImage('user', '01A', { ...data, age: 31 }),
      }),
    );

    expect(batchWriteItem).not.toHaveBeenCalled();
  });

  it('skips removals, other rows and types without search', async () => {
    const { repository, batchWriteItem } = createSearchRepository();
    const container = {
      searchRepository: repository,
    } as unknown as DependencyContainer;
    const image = metadataImage('user', '01A', { name: 'John' });

    await syncSearchIndex(
      container,
      streamRecord('REMOVE', { OldImage: image }),
    );
    await syncSearchIndex(
      container,
      streamRecord('INSERT', {
        NewImage: { ...image, SK: { S: 'user#01A' }, PK: { S: 'LIST#user' } },
      }),
    );
    await syncSearchIndex(
      container,
      streamRecord('INSERT', {
        NewImage: { ...image, PK: { S: 'MUTUAL#01A' } },
      }),
    );
    await syncSearchIndex(
      container,
      streamRecord('INSERT', {
        NewImage: metadataImage('admin', '01B', { name: 'Ann' }),
      }),
    );

    expect(batchWriteItem).not.toHaveBeenCalled();
  });

  it('retries unprocessed writes', async () => {
    const { repository, batchWriteItem } = createSearchRepository();
    batchWriteItem.mockImplementationOnce(async (input) => ({
      UnprocessedItems: { table: input.RequestItems?.table?.slice(0, 1) ?? [] },
    }));

    await syncSearchIndex(
      { searchRepository: repository } as unknown as DependencyContainer,
      streamRecord('INSERT', {
        NewImage: metadataImage('product', '01P', { name: 'Red Chair' }),
      }),
    );

    expect(batchWriteItem).toHaveBeenCalledTimes(2);
    expect(batchWriteItem.mock.calls[1][0].RequestItems?.table).toHaveLength(1);
  });
});

describe('search reindex handler', () => {
  const userHash = searchConfigHash(
    resolveSearchConfig(entityConfig[USER].search as never),
  );
  const productHash = searchConfigHash(
    resolveSearchConfig(entityConfig[PRODUCT].search as never),
  );

  const setUp = (
    pages: { items: Entity<EntityType>[]; lastKey?: string }[] = [],
  ) => {
    const repository = new SearchRepository(
      entityConfig,
      'table',
      {} as DynamoDB,
      {} as EntityRepository,
    );
    const states: Record<string, { state: string; configHash: string }> = {
      user: { state: 'ready', configHash: userHash },
    };
    vi.spyOn(repository, 'getIndexState').mockImplementation(
      async (entityType) => states[`${entityType}`],
    );
    const markIndexBuilding = vi
      .spyOn(repository, 'markIndexBuilding')
      .mockResolvedValue(undefined);
    const markIndexReady = vi
      .spyOn(repository, 'markIndexReady')
      .mockResolvedValue(true);
    const reindexEntity = vi
      .spyOn(repository, 'reindexEntity')
      .mockResolvedValue(undefined);
    const clearIndexState = vi
      .spyOn(repository, 'clearIndexState')
      .mockResolvedValue(undefined);
    const listEntities = vi.fn();
    for (const page of pages) listEntities.mockResolvedValueOnce(page);
    const invoke = vi.fn(async (_: SearchReindexEvent) => {});
    const pause = vi.fn(async (_: number) => {});
    const run = handler(
      {
        config: { EntityConfig: entityConfig },
        searchRepository: repository,
        entityRepository: { listEntities },
      } as unknown as DependencyContainer,
      invoke,
      pause,
    );
    return {
      run,
      invoke,
      pause,
      markIndexBuilding,
      markIndexReady,
      reindexEntity,
      clearIndexState,
      listEntities,
    };
  };

  const entity = (id: string) =>
    new Entity(PRODUCT, id, { name: `Chair ${id}` });

  it('starts a reindex only for types not built for their current config', async () => {
    const { run, invoke, markIndexBuilding } = setUp();

    await run({ action: 'start' });

    expect(markIndexBuilding).toHaveBeenCalledExactlyOnceWith(
      PRODUCT,
      productHash,
    );
    expect(invoke).toHaveBeenCalledExactlyOnceWith({
      action: 'reindex',
      entityType: PRODUCT,
      configHash: productHash,
    });
  });

  it('starts a reindex for every indexed type with force', async () => {
    const { run, invoke } = setUp();

    await run({ action: 'start', force: true });

    expect(invoke.mock.calls.map(([event]) => event)).toEqual([
      { action: 'reindex', entityType: USER, configHash: userHash },
      { action: 'reindex', entityType: PRODUCT, configHash: productHash },
    ]);
  });

  it('clears the marker of types without search, so re-adding it rebuilds', async () => {
    const { run, clearIndexState } = setUp();

    await run({ action: 'start' });

    expect(clearIndexState).toHaveBeenCalledExactlyOnceWith('admin');
  });

  it('reindexes every page, then marks the type ready', async () => {
    const { run, reindexEntity, markIndexReady, listEntities } = setUp([
      { items: [entity('01'), entity('02')], lastKey: 'k1' },
      { items: [entity('03')] },
    ]);

    await run({
      action: 'reindex',
      entityType: PRODUCT,
      configHash: productHash,
    });

    expect(listEntities).toHaveBeenNthCalledWith(2, {
      entityType: PRODUCT,
      limit: 100,
      options: { lastKey: 'k1' },
    });
    expect(
      reindexEntity.mock.calls.map(([type, id]) => `${type}#${id}`),
    ).toEqual(['product#01', 'product#02', 'product#03']);
    expect(markIndexReady).toHaveBeenCalledExactlyOnceWith(
      PRODUCT,
      productHash,
    );
  });

  it('hands the rest to a new invocation when running low on time', async () => {
    const { run, invoke, markIndexReady } = setUp([
      { items: [entity('01')], lastKey: 'k1' },
    ]);

    await run(
      { action: 'reindex', entityType: PRODUCT, configHash: productHash },
      { getRemainingTimeInMillis: () => 30_000 },
    );

    expect(invoke).toHaveBeenCalledExactlyOnceWith({
      action: 'reindex',
      entityType: PRODUCT,
      configHash: productHash,
      lastKey: 'k1',
    });
    expect(markIndexReady).not.toHaveBeenCalled();
  });

  it('retries a failed page from the same page in a new invocation', async () => {
    const { run, invoke, pause, listEntities, markIndexReady } = setUp();
    listEntities.mockRejectedValueOnce(new Error('ThrottlingException'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await run({
      action: 'reindex',
      entityType: PRODUCT,
      configHash: productHash,
      lastKey: 'k1',
    });

    expect(pause).toHaveBeenCalledExactlyOnceWith(5000);
    expect(invoke).toHaveBeenCalledExactlyOnceWith({
      action: 'reindex',
      entityType: PRODUCT,
      configHash: productHash,
      lastKey: 'k1',
      failures: 1,
    });
    expect(markIndexReady).not.toHaveBeenCalled();
  });

  it('waits longer before each retry of the same page', async () => {
    const { run, pause, reindexEntity } = setUp([{ items: [entity('01')] }]);
    reindexEntity.mockRejectedValueOnce(new Error('ThrottlingException'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await run({
      action: 'reindex',
      entityType: PRODUCT,
      configHash: productHash,
      failures: 1,
    });

    expect(pause).toHaveBeenCalledExactlyOnceWith(10000);
  });

  it('fails the invocation once a page has failed three times in a row', async () => {
    const { run, invoke, markIndexReady, listEntities } = setUp();
    const error = new Error('ThrottlingException');
    listEntities.mockRejectedValueOnce(error);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      run({
        action: 'reindex',
        entityType: PRODUCT,
        configHash: productHash,
        lastKey: 'k1',
        failures: 2,
      }),
    ).rejects.toBe(error);

    expect(invoke).not.toHaveBeenCalled();
    expect(markIndexReady).not.toHaveBeenCalled();
  });

  it('starts counting again after a page succeeds', async () => {
    const { run, markIndexReady, invoke } = setUp([{ items: [entity('01')] }]);

    await run({
      action: 'reindex',
      entityType: PRODUCT,
      configHash: productHash,
      failures: 2,
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(markIndexReady).toHaveBeenCalledExactlyOnceWith(
      PRODUCT,
      productHash,
    );
  });

  it('reindexes a page at most 25 entities at a time', async () => {
    const items = Array.from({ length: 30 }, (_, i) =>
      entity(`${i}`.padStart(2, '0')),
    );
    const { run, reindexEntity } = setUp([{ items }]);
    let running = 0;
    let most = 0;
    reindexEntity.mockImplementation(async () => {
      running++;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running--;
    });

    await run({
      action: 'reindex',
      entityType: PRODUCT,
      configHash: productHash,
    });

    expect(reindexEntity).toHaveBeenCalledTimes(30);
    expect(most).toBe(25);
  });

  it('stops when the config changed since the reindex started', async () => {
    const { run, listEntities, markIndexReady } = setUp();

    await run({ action: 'reindex', entityType: PRODUCT, configHash: 'old' });

    expect(listEntities).not.toHaveBeenCalled();
    expect(markIndexReady).not.toHaveBeenCalled();
  });
});
