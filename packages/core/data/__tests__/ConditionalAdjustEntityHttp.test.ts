import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Entity as EntityType, createEntityConfig } from '../../../base';
import { setupCommonRoutes } from '../../controllers/setupRoutes';
import {
  MockEntityType,
  createDynamoDbClient,
  createMockEntityConfig,
  createTestTable,
  deleteTestTable,
  getTableName,
} from '../../helpers/test/test-utils';
import { DependencyContainer } from '../../services/DependencyContainer';

const TABLE_NAME = getTableName();
const dynamodbClient = createDynamoDbClient();
const mockEntityConfig = createMockEntityConfig();

const container = new DependencyContainer({
  EntityConfig: mockEntityConfig as unknown as Record<
    EntityType,
    ReturnType<typeof createEntityConfig>
  >,
  AllowedEntityTypes: Object.values(MockEntityType) as unknown as EntityType[],
  EmailAuthEnabledEntities: [],
  tableName: TABLE_NAME,
});
// biome-ignore lint/suspicious/noExplicitAny: accessing private field for test injection
(container as any)._instanceCache.set('DynamoDB', dynamodbClient);
// biome-ignore lint/suspicious/noExplicitAny: accessing private field for test injection
(container as any)._publishEvent = vi.fn().mockResolvedValue(undefined);

const app = new Hono();
app.route('/', setupCommonRoutes(container));

const entityRepository = container.entityRepository;

type PostResult = { status: number; data: Record<string, unknown> };

const adjust = async (
  entityType: string,
  entityId: string,
  body: object,
): Promise<PostResult> => {
  const res = await app.request(`/entity/${entityType}/${entityId}/adjust`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    data: (await res.json()) as Record<string, unknown>,
  };
};

const WALLET = MockEntityType.WALLET as unknown as EntityType;
const USER = MockEntityType.USER as unknown as EntityType;

describe('HTTP — conditional adjustEntity ($condition)', () => {
  beforeAll(async () => {
    await createTestTable(TABLE_NAME, dynamodbClient);
  }, 60000);

  afterAll(async () => {
    await deleteTestTable(TABLE_NAME, dynamodbClient);
  }, 60000);

  it('should require $condition when entity has conditions defined', async () => {
    const entity = await entityRepository.createEntity(WALLET, {
      balance: 100,
    });
    const { status, data } = await adjust(
      MockEntityType.WALLET,
      entity.entityId as string,
      { balance: -10 },
    );
    expect(status).toBe(400);
    expect(data.code).toBe('INVALID_CONDITION');
  });

  it('should succeed with valid $condition (static)', async () => {
    const entity = await entityRepository.createEntity(WALLET, {
      balance: 100,
    });
    const { status, data } = await adjust(
      MockEntityType.WALLET,
      entity.entityId as string,
      { balance: 50, $condition: 'deposit' },
    );
    expect(status).toBe(200);
    expect((data.data as Record<string, unknown>).balance).toBe(150);
  });

  it('should fail when static condition violated', async () => {
    const entity = await entityRepository.createEntity(WALLET, {
      balance: 10001,
    });
    const { status } = await adjust(
      MockEntityType.WALLET,
      entity.entityId as string,
      { balance: 50, $condition: 'deposit' },
    );
    // balance is 10001, deposit condition: balance <= 10000 → fails
    expect(status).toBe(409);
  });

  it('should succeed with dynamic $condition (function)', async () => {
    const entity = await entityRepository.createEntity(WALLET, {
      balance: 100,
      minBalance: 0,
    });
    const { status, data } = await adjust(
      MockEntityType.WALLET,
      entity.entityId as string,
      { balance: -50, $condition: 'withdraw' },
    );
    expect(status).toBe(200);
    expect((data.data as Record<string, unknown>).balance).toBe(50);
  });

  it('should fail when dynamic condition violated', async () => {
    const entity = await entityRepository.createEntity(WALLET, {
      balance: 30,
      minBalance: 0,
    });
    const { status } = await adjust(
      MockEntityType.WALLET,
      entity.entityId as string,
      { balance: -50, $condition: 'withdraw' },
    );
    // withdraw condition: balance >= minBalance(0) + abs(-50) = 50, but balance is 30
    expect(status).toBe(409);
  });

  it('should return 400 for unknown condition name', async () => {
    const entity = await entityRepository.createEntity(WALLET, {
      balance: 100,
    });
    const { status, data } = await adjust(
      MockEntityType.WALLET,
      entity.entityId as string,
      { balance: 10, $condition: 'nonexistent' },
    );
    expect(status).toBe(400);
    expect(data.code).toBe('INVALID_CONDITION');
  });

  it('should work without $condition when entity has no conditions defined', async () => {
    const entity = await entityRepository.createEntity(USER, {
      name: 'test',
      username: `user-adjust-${Date.now()}`,
      age: 25,
    });
    const { status, data } = await adjust(
      MockEntityType.USER,
      entity.entityId as string,
      { age: 5 },
    );
    expect(status).toBe(200);
    expect((data.data as Record<string, unknown>).age).toBe(30);
  });

  it('should handle concurrent withdraw with condition', async () => {
    const entity = await entityRepository.createEntity(WALLET, {
      balance: 3,
      minBalance: 0,
    });

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        adjust(MockEntityType.WALLET, entity.entityId as string, {
          balance: -1,
          $condition: 'withdraw',
        }),
      ),
    );

    const successes = results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => (r as PromiseFulfilledResult<PostResult>).value)
      .filter((v) => v.status === 200);

    const conflicts = results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => (r as PromiseFulfilledResult<PostResult>).value)
      .filter((v) => v.status === 409);

    expect(successes).toHaveLength(3);
    expect(conflicts).toHaveLength(2);

    const fetched = await entityRepository.getEntity(
      WALLET,
      entity.entityId as string,
    );
    expect(fetched.data.balance).toBe(0);
  });
});
