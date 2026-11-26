import type {
  DynamoDB,
  GetItemCommandInput,
  QueryCommandInput,
} from '@aws-sdk/client-dynamodb';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  createEntityConfig,
  resolveSearchConfig,
  searchConfigHash,
} from '../../../base';
import type { Entity as EntityType } from '../../../base';
import { Entity, type EntityRepository } from '../Entity';
import { SearchRepository } from '../Search';

const USER = 'user' as unknown as EntityType;

const userConfig = createEntityConfig({
  name: USER,
  displayName: 'User',
  baseSchema: z.object({ name: z.string(), email: z.string() }).partial(),
  search: { fields: [{ field: 'name' }, { field: 'email' }] },
});
const userHash = searchConfigHash(
  resolveSearchConfig(userConfig.search as never),
);

const user = (id: string, name: string, email = `${id}@mail.com`) =>
  new Entity(USER, id, { name, email });

const setUp = ({
  state,
  pages = [],
  all = [],
}: {
  state?: { state: string; configHash: string };
  pages?: { rows: Entity<EntityType>[]; lastKey?: string }[];
  all?: Entity<EntityType>[];
}) => {
  const getItem = vi.fn(async (_: GetItemCommandInput) => ({
    Item: state && {
      state: { S: state.state },
      configHash: { S: state.configHash },
    },
  }));
  const query = vi.fn();
  for (const page of pages) {
    query.mockResolvedValueOnce({
      Items: page.rows.map((entity) => entity.toItem()),
      LastEvaluatedKey: page.lastKey && { PK: { S: page.lastKey } },
    });
  }
  const listEntities = vi.fn(async () => ({ items: all }));
  const repository = new SearchRepository(
    { [USER]: userConfig } as unknown as ConstructorParameters<
      typeof SearchRepository
    >[0],
    'table',
    { getItem, query } as unknown as DynamoDB,
    { listEntities } as unknown as EntityRepository,
  );
  return { repository, getItem, query, listEntities };
};

describe('SearchRepository.searchEntities', () => {
  it('scans every entity until the index is built for the current config', async () => {
    const { repository, query, listEntities } = setUp({
      state: { state: 'building', configHash: userHash },
      all: [
        user('01A', 'John Doe'),
        user('01C', 'Jane Roe'),
        user('01B', 'Johnny Doerr'),
      ],
    });

    const { items, totalCount, filteredCount } =
      await repository.searchEntities(USER, 'john do');

    expect(listEntities).toHaveBeenCalledOnce();
    expect(query).not.toHaveBeenCalled();
    expect(items.map((item) => item.entityId)).toEqual(['01B', '01A']);
    expect(filteredCount).toBe(2);
    // not the scan's count of every entity, even while it scans
    expect(totalCount).toBeUndefined();
  });

  it('scans when the index was built for a different config', async () => {
    const { repository, listEntities } = setUp({
      state: { state: 'ready', configHash: 'other' },
    });

    await repository.searchEntities(USER, 'john');

    expect(listEntities).toHaveBeenCalledOnce();
  });

  it("reads the longest word's rows once the index is ready", async () => {
    const johnDoe = user('01A', 'John Doe');
    const { repository, query, listEntities } = setUp({
      state: { state: 'ready', configHash: userHash },
      pages: [
        // "johnny" and "john" are both under the anchor prefix "john"
        { rows: [johnDoe, user('01B', 'Johnny Doerr')], lastKey: 'next' },
        { rows: [johnDoe, user('01C', 'John Smith')] },
      ],
    });

    const { items } = await repository.searchEntities(USER, 'do john');

    expect(listEntities).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(2);
    const input = query.mock.calls[0][0] as QueryCommandInput;
    expect(input.ExpressionAttributeValues).toEqual({
      ':PK': { S: 'SEARCH#user' },
      ':SK': { S: 'john' },
    });
    expect(
      (query.mock.calls[1][0] as QueryCommandInput).ExclusiveStartKey,
    ).toEqual({
      PK: { S: 'next' },
    });
    expect(items.map((item) => item.entityId)).toEqual(['01B', '01A']);
  });

  it('checks readiness once per instance after it is ready', async () => {
    const { repository, getItem, query } = setUp({
      state: { state: 'ready', configHash: userHash },
    });
    query.mockResolvedValue({ Items: [] });

    await repository.searchEntities(USER, 'john');
    await repository.searchEntities(USER, 'jane');

    expect(getItem).toHaveBeenCalledOnce();
  });

  it('reads nothing for a query without a word to look up', async () => {
    const { repository, getItem, listEntities } = setUp({});

    expect(await repository.searchEntities(USER, 'j')).toEqual({
      items: [],
      filteredCount: 0,
    });
    expect(getItem).not.toHaveBeenCalled();
    expect(listEntities).not.toHaveBeenCalled();
  });
});
