import type { DynamoDB } from '@aws-sdk/client-dynamodb';
import type { Entity as EntityType } from '@monorise/base';
import { describe, expect, it, vi } from 'vitest';
import { EntityRepository } from '../Entity';

// A stubbed client rather than LocalStack: the fix is in the key condition
// the repository sends, which is what this checks.
const repositoryWith = (query: ReturnType<typeof vi.fn>) =>
  new EntityRepository(
    // biome-ignore lint/suspicious/noExplicitAny: no entity configs are needed for these lookups
    {} as any,
    'table',
    { query } as unknown as DynamoDB,
    [],
  );

const user = 'user' as unknown as EntityType;

describe('unique field lookups', () => {
  it("matches the entity type exactly, so 'user' never returns a 'user-profile'", async () => {
    const query = vi.fn().mockResolvedValue({
      Items: [
        {
          entityType: { S: 'user' },
          entityId: { S: '1' },
          data: { M: {} },
        },
      ],
    });

    await repositoryWith(query).getEntityByUniqueField(user, 'email', 'a@b.co');

    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        KeyConditionExpression: '#PK = :PK and #SK = :SK',
        ExpressionAttributeValues: {
          ':PK': { S: 'UNIQUE#email#a@b.co' },
          ':SK': { S: 'user' },
        },
      }),
    );
  });

  it('checks availability against the exact entity type too', async () => {
    const query = vi.fn().mockResolvedValue({ Items: [] });

    await repositoryWith(query).getUniqueFieldValueAvailability(
      user,
      'email',
      'a@b.co',
    );

    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        KeyConditionExpression: '#PK = :PK and #SK = :SK',
      }),
    );
  });
});
