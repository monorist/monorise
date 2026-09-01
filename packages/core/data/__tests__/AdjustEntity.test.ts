import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Entity as EntityType } from '../../../base';
import {
  MockEntityType,
  createDynamoDbClient,
  createMockEntityConfig,
  createTestTable,
  deleteTestTable,
  getTableName,
} from '../../helpers/test/test-utils';
import { type Entity, EntityRepository } from '../Entity';
import { buildConditionExpression } from '../utils/build-condition-expression';

const TABLE_NAME = getTableName();
const dynamodbClient = createDynamoDbClient();
const mockEntityConfig = createMockEntityConfig();

const entityRepository = new EntityRepository(
  mockEntityConfig,
  TABLE_NAME,
  dynamodbClient,
  [],
);

describe('EntityRepository — adjustEntity', () => {
  let wallet: Entity<EntityType>;

  beforeAll(async () => {
    await createTestTable(TABLE_NAME, dynamodbClient);
    wallet = await entityRepository.createEntity(
      MockEntityType.WALLET as unknown as EntityType,
      { balance: 100, credits: 50 },
    );
  }, 60000);

  afterAll(async () => {
    await deleteTestTable(TABLE_NAME, dynamodbClient);
  }, 60000);

  it('should increment a field', async () => {
    const result = await entityRepository.adjustEntity(
      MockEntityType.WALLET as unknown as EntityType,
      wallet.entityId as string,
      { balance: 50 },
    );
    expect(result.data.balance).toBe(150);
    const fetched = await entityRepository.getEntity(
      MockEntityType.WALLET as unknown as EntityType,
      wallet.entityId as string,
    );
    expect(fetched.data.balance).toBe(150);
    wallet = result;
  });

  it('should decrement a field', async () => {
    const result = await entityRepository.adjustEntity(
      MockEntityType.WALLET as unknown as EntityType,
      wallet.entityId as string,
      { balance: -30 },
    );
    expect(result.data.balance).toBe(120);
    const fetched = await entityRepository.getEntity(
      MockEntityType.WALLET as unknown as EntityType,
      wallet.entityId as string,
    );
    expect(fetched.data.balance).toBe(120);
    wallet = result;
  });

  it('should adjust multiple fields in one call', async () => {
    const result = await entityRepository.adjustEntity(
      MockEntityType.WALLET as unknown as EntityType,
      wallet.entityId as string,
      { balance: 10, credits: 5 },
    );
    expect(result.data.balance).toBe(130);
    expect(result.data.credits).toBe(55);
    const fetched = await entityRepository.getEntity(
      MockEntityType.WALLET as unknown as EntityType,
      wallet.entityId as string,
    );
    expect(fetched.data.balance).toBe(130);
    expect(fetched.data.credits).toBe(55);
    wallet = result;
  });

  it('should initialize a non-existent field to 0 before applying delta', async () => {
    const result = await entityRepository.adjustEntity(
      MockEntityType.WALLET as unknown as EntityType,
      wallet.entityId as string,
      { score: 10 },
    );
    expect(result.data.score).toBe(10);
    const fetched = await entityRepository.getEntity(
      MockEntityType.WALLET as unknown as EntityType,
      wallet.entityId as string,
    );
    expect(fetched.data.score).toBe(10);
    wallet = result;
  });

  it('should bump updatedAt after adjustment', async () => {
    const beforeUpdatedAt = wallet.updatedAt ?? '';
    await new Promise((resolve) => setTimeout(resolve, 50));
    const result = await entityRepository.adjustEntity(
      MockEntityType.WALLET as unknown as EntityType,
      wallet.entityId as string,
      { balance: 1 },
    );
    expect(result.updatedAt).toBeDefined();
    expect((result.updatedAt ?? '') > beforeUpdatedAt).toBe(true);
    const fetched = await entityRepository.getEntity(
      MockEntityType.WALLET as unknown as EntityType,
      wallet.entityId as string,
    );
    expect(fetched.updatedAt).toBe(result.updatedAt);
    wallet = result;
  });

  it('should not lose data under concurrent adjustments', async () => {
    const balanceBefore = wallet.data.balance as number;
    await Promise.all(
      Array.from({ length: 5 }, () =>
        entityRepository.adjustEntity(
          MockEntityType.WALLET as unknown as EntityType,
          wallet.entityId as string,
          { balance: 1 },
        ),
      ),
    );
    const fetched = await entityRepository.getEntity(
      MockEntityType.WALLET as unknown as EntityType,
      wallet.entityId as string,
    );
    expect(fetched.data.balance).toBe(balanceBefore + 5);
    wallet = fetched;
  });

  it('should not allow balance to drop below 0 under concurrent decrements', async () => {
    // Set balance to exactly 3 so only 3 of 5 concurrent decrements can succeed
    const resetResult = await entityRepository.adjustEntity(
      MockEntityType.WALLET as unknown as EntityType,
      wallet.entityId as string,
      { balance: 3 - (wallet.data.balance as number) },
    );
    wallet = resetResult;

    // Condition: balance >= 1 (min:0 + abs(delta):1)
    const opts = buildConditionExpression({ balance: { $gte: 1 } });
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        entityRepository.adjustEntity(
          MockEntityType.WALLET as unknown as EntityType,
          wallet.entityId as string,
          { balance: -1 },
          opts,
        ),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(3);
    expect(rejected).toHaveLength(2);
    expect(
      rejected.every(
        (r) =>
          (r as PromiseRejectedResult).reason?.name ===
          'ConditionalCheckFailedException',
      ),
    ).toBe(true);

    const fetched = await entityRepository.getEntity(
      MockEntityType.WALLET as unknown as EntityType,
      wallet.entityId as string,
    );
    expect(fetched.data.balance).toBe(0);
    // Restore balance for subsequent tests
    wallet = await entityRepository.adjustEntity(
      MockEntityType.WALLET as unknown as EntityType,
      fetched.entityId as string,
      { balance: 100 },
    );
  });

  it('should succeed when decrement stays above static min', async () => {
    // balance is currently 100; decrementing by 30 stays above min: 0
    // Condition: balance >= 30 (min:0 + abs(delta):30)
    const opts = buildConditionExpression({ balance: { $gte: 30 } });
    const result = await entityRepository.adjustEntity(
      MockEntityType.WALLET as unknown as EntityType,
      wallet.entityId as string,
      { balance: -30 },
      opts,
    );
    expect(result.data.balance).toBe((wallet.data.balance as number) - 30);
    const fetched = await entityRepository.getEntity(
      MockEntityType.WALLET as unknown as EntityType,
      wallet.entityId as string,
    );
    expect(fetched.data.balance).toBe(result.data.balance);
    wallet = result;
  });

  it('should throw when decrement violates static min', async () => {
    // decrement by 200 would push below min: 0
    // Condition: balance >= 200 (min:0 + abs(delta):200)
    const opts = buildConditionExpression({ balance: { $gte: 200 } });
    await expect(
      entityRepository.adjustEntity(
        MockEntityType.WALLET as unknown as EntityType,
        wallet.entityId as string,
        { balance: -200 },
        opts,
      ),
    ).rejects.toMatchObject({ name: 'ConditionalCheckFailedException' });
    const fetched = await entityRepository.getEntity(
      MockEntityType.WALLET as unknown as EntityType,
      wallet.entityId as string,
    );
    expect(fetched.data.balance).toBe(wallet.data.balance);
  });

  it('should succeed when increment stays below static max', async () => {
    // credits: 55; incrementing by 40 stays below max: 100
    // Condition: credits <= 60 (max:100 - delta:40)
    const opts = buildConditionExpression({ credits: { $lte: 60 } });
    const result = await entityRepository.adjustEntity(
      MockEntityType.WALLET as unknown as EntityType,
      wallet.entityId as string,
      { credits: 40 },
      opts,
    );
    expect(result.data.credits).toBe(95);
    const fetched = await entityRepository.getEntity(
      MockEntityType.WALLET as unknown as EntityType,
      wallet.entityId as string,
    );
    expect(fetched.data.credits).toBe(95);
    wallet = result;
  });

  it('should throw when increment violates static max', async () => {
    // credits: 95; incrementing by 10 would exceed max: 100
    // Condition: credits <= 90 (max:100 - delta:10)
    const opts = buildConditionExpression({ credits: { $lte: 90 } });
    await expect(
      entityRepository.adjustEntity(
        MockEntityType.WALLET as unknown as EntityType,
        wallet.entityId as string,
        { credits: 10 },
        opts,
      ),
    ).rejects.toMatchObject({ name: 'ConditionalCheckFailedException' });
    const fetched = await entityRepository.getEntity(
      MockEntityType.WALLET as unknown as EntityType,
      wallet.entityId as string,
    );
    expect(fetched.data.credits).toBe(wallet.data.credits);
  });

  it('should succeed with condition when incrementing (no min violated)', async () => {
    // No condition needed for increment with min constraint — pass no opts
    const result = await entityRepository.adjustEntity(
      MockEntityType.WALLET as unknown as EntityType,
      wallet.entityId as string,
      { balance: 5 },
    );
    expect(result.data.balance).toBe((wallet.data.balance as number) + 5);
    const fetched = await entityRepository.getEntity(
      MockEntityType.WALLET as unknown as EntityType,
      wallet.entityId as string,
    );
    expect(fetched.data.balance).toBe(result.data.balance);
    wallet = result;
  });

  it('should succeed with condition when decrementing (no max violated)', async () => {
    // No condition needed for decrement with max constraint — pass no opts
    const result = await entityRepository.adjustEntity(
      MockEntityType.WALLET as unknown as EntityType,
      wallet.entityId as string,
      { credits: -10 },
    );
    expect(result.data.credits).toBe(85);
    const fetched = await entityRepository.getEntity(
      MockEntityType.WALLET as unknown as EntityType,
      wallet.entityId as string,
    );
    expect(fetched.data.credits).toBe(85);
    wallet = result;
  });
});
