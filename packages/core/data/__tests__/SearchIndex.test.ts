import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createEntityConfig } from '../../../base';
import type { Entity as EntityType } from '../../../base';
import {
  StreamHandler,
  createDynamoDbClient,
  createReplicationHandler,
  createStreamClient,
  createTestTable,
  deleteTestTable,
  getTableName,
  waitForStreamReady,
} from '../../helpers/test/test-utils';
import { handler as searchReindexHandler } from '../../processors/search-index-processor';
import type { DependencyContainer } from '../../services/DependencyContainer';
import { EntityRepository } from '../Entity';
import { SearchRepository } from '../Search';

const MEMBER = 'member' as unknown as EntityType;

const entityConfig = {
  [MEMBER]: createEntityConfig({
    name: MEMBER,
    displayName: 'Member',
    baseSchema: z
      .object({ name: z.string(), email: z.string(), age: z.number() })
      .partial(),
    search: { fields: [{ field: 'name' }, { field: 'email' }] },
  }),
} as unknown as ConstructorParameters<typeof EntityRepository>[0];

const TABLE_NAME = getTableName();
const dynamodbClient = createDynamoDbClient();
const streamClient = createStreamClient();
const streamHandler = new StreamHandler(
  TABLE_NAME,
  dynamodbClient,
  streamClient,
);
const entityRepository = new EntityRepository(
  entityConfig,
  TABLE_NAME,
  dynamodbClient,
  [],
);
const searchRepository = new SearchRepository(
  entityConfig,
  TABLE_NAME,
  dynamodbClient,
  entityRepository,
);
const replicationHandler = createReplicationHandler(
  TABLE_NAME,
  dynamodbClient,
  searchRepository,
);

// Runs stream records through the replication processor until `done`.
const processStream = async (done: () => Promise<boolean>) => {
  for (let attempt = 0; attempt < 20; attempt++) {
    const records = await streamHandler.getNextRecords();
    await replicationHandler({ Records: records ?? [] });
    if (await done()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('stream records did not arrive');
};

const searchRowWords = async (entityId: string) =>
  (await searchRepository.existingWords(MEMBER, entityId)).sort();

const search = async (query: string) =>
  (await searchRepository.searchEntities(MEMBER, query)).items.map(
    (item) => item.data.name,
  );

describe('search index', () => {
  let johnId: string;
  let janeId: string;

  beforeAll(async () => {
    await createTestTable(TABLE_NAME, dynamodbClient, { enableStream: true });
    await waitForStreamReady(TABLE_NAME, dynamodbClient, streamClient);
    await streamHandler.initialize();
  }, 60000);

  afterAll(async () => {
    await deleteTestTable(TABLE_NAME, dynamodbClient);
  }, 60000);

  it('indexes a created entity from the stream', async () => {
    johnId = (
      await entityRepository.createEntity(MEMBER, {
        name: 'John Doe',
        email: 'john.doe@mail.com',
      })
    ).entityId as string;
    janeId = (
      await entityRepository.createEntity(MEMBER, {
        name: 'Jane Roe',
        email: 'jane@example.com',
      })
    ).entityId as string;

    await processStream(async () => (await searchRowWords(janeId)).length > 0);

    expect(await searchRowWords(johnId)).toEqual([
      'com',
      'doe',
      'john',
      'mail',
    ]);
    expect(await searchRowWords(janeId)).toEqual([
      'com',
      'example',
      'jane',
      'roe',
    ]);
  }, 20000);

  it('scans until the index is marked ready', async () => {
    expect(
      await searchRepository.isIndexReady(
        MEMBER,
        searchRepository.searchConfig(MEMBER)!,
      ),
    ).toBe(false);
    expect(await search('john do')).toEqual(['John Doe']);
  });

  it('marks the index ready after a reindex, then reads it', async () => {
    const container = {
      config: { EntityConfig: entityConfig },
      searchRepository,
      entityRepository,
    } as unknown as DependencyContainer;
    const run = searchReindexHandler(container, async (event) => run(event));

    await run({ action: 'start' });

    expect(await searchRepository.getIndexState(MEMBER)).toMatchObject({
      state: 'ready',
    });
    expect(await search('john do')).toEqual(['John Doe']);
    expect(await search('example@mail.com')).toEqual([]);
    expect(await search('jane@example.com')).toEqual(['Jane Roe']);
    expect(await search('"doe john"')).toEqual([]);
  }, 20000);

  it('follows updates: new words added, old ones removed, data kept current', async () => {
    await entityRepository.updateEntity(MEMBER, johnId, {
      data: { name: 'John Smith', email: 'js@mail.com' },
    });

    await processStream(async () =>
      (await searchRowWords(johnId)).includes('smith'),
    );

    expect(await searchRowWords(johnId)).toEqual([
      'com',
      'john',
      'js',
      'mail',
      'smith',
    ]);
    expect(await search('smith')).toEqual(['John Smith']);
    // the "john" row was kept and got the new data from replication
    expect(await search('john')).toEqual(['John Smith']);
    expect(await search('doe')).toEqual([]);
  }, 20000);

  it('removes the rows with the entity', async () => {
    await entityRepository.deleteEntity(MEMBER, janeId);

    await processStream(
      async () => (await searchRowWords(janeId)).length === 0,
    );

    expect(await search('jane')).toEqual([]);
  }, 20000);

  it('drops rows the current config would not write when reindexing', async () => {
    const john = await entityRepository.getEntity(MEMBER, johnId);
    await searchRepository.writeRows(john, ['stale'], []);
    expect(await searchRowWords(johnId)).toContain('stale');

    await searchRepository.reindexEntity(
      MEMBER,
      johnId,
      searchRepository.searchConfig(MEMBER)!,
    );

    expect(await searchRowWords(johnId)).toEqual([
      'com',
      'john',
      'js',
      'mail',
      'smith',
    ]);
  });
});
