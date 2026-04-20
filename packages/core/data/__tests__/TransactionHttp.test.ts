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
// biome-ignore lint/suspicious/noExplicitAny: test injection
(container as any)._instanceCache.set('DynamoDB', dynamodbClient);
const mockPublishEvent = vi.fn().mockResolvedValue(undefined);
// biome-ignore lint/suspicious/noExplicitAny: test injection
(container as any)._publishEvent = mockPublishEvent;

const app = new Hono();
app.route('/', setupCommonRoutes(container));

const entityRepository = container.entityRepository;

type PostResult = {
  status: number;
  data: Record<string, unknown>;
};

const post = async (body: object): Promise<PostResult> => {
  const res = await app.request('/transaction', {
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
const PRODUCT = MockEntityType.PRODUCT as unknown as EntityType;
const USER = MockEntityType.USER as unknown as EntityType;

describe('POST /transaction', () => {
  beforeAll(async () => {
    await createTestTable(TABLE_NAME, dynamodbClient);
  }, 60000);

  afterAll(async () => {
    await deleteTestTable(TABLE_NAME, dynamodbClient);
  }, 60000);

  beforeEach(() => {
    mockPublishEvent.mockClear();
  });

  // ─── Validation ──────────────────────────────────────────────────────────

  it('should return 400 for missing operations field', async () => {
    const { status, data } = await post({});
    expect(status).toBe(400);
    expect(data.code).toBe('API_VALIDATION_ERROR');
  });

  it('should return 400 for empty operations array', async () => {
    const { status, data } = await post({ operations: [] });
    expect(status).toBe(400);
    expect(data.code).toBe('TRANSACTION_EMPTY');
  });

  it('should return 400 for unknown entity type', async () => {
    const { status, data } = await post({
      operations: [
        {
          operation: 'createEntity',
          entityType: 'nonexistent',
          payload: {},
        },
      ],
    });
    expect(status).toBe(400);
    expect(data.code).toBe('INVALID_ENTITY_TYPE');
  });

  it('should return 400 for schema validation failure', async () => {
    const { status, data } = await post({
      operations: [
        {
          operation: 'createEntity',
          entityType: MockEntityType.PRODUCT,
          payload: { name: 123 },
        },
      ],
    });
    expect(status).toBe(400);
  });

  it('should return 400 for updateEntity touching unique fields', async () => {
    const entity = await entityRepository.createEntity(USER, {
      name: 'test',
      username: `unique-field-tx-${Date.now()}`,
    });
    const { status, data } = await post({
      operations: [
        {
          operation: 'updateEntity',
          entityType: MockEntityType.USER,
          entityId: entity.entityId,
          payload: { username: 'new-username' },
        },
      ],
    });
    expect(status).toBe(400);
    expect(data.code).toBe('TRANSACTION_UNIQUE_FIELD_UPDATE');
  });

  // ─── Single operations ───────────────────────────────────────────────────

  it('should create entity in transaction', async () => {
    const { status, data } = await post({
      operations: [
        {
          operation: 'createEntity',
          entityType: MockEntityType.PRODUCT,
          payload: { name: 'tx-product', description: 'test', price: 100 },
        },
      ],
    });
    expect(status).toBe(200);
    const results = data.results as Array<Record<string, unknown>>;
    expect(results).toHaveLength(1);
    expect(results[0].operation).toBe('createEntity');
    expect(results[0].entityId).toBeDefined();

    const entityId = results[0].entityId as string;
    const stored = await entityRepository.getEntity(PRODUCT, entityId);
    expect(stored.data.name).toBe('tx-product');
  });

  it('should update entity in transaction', async () => {
    const entity = await entityRepository.createEntity(PRODUCT, {
      name: 'before',
      description: 'test',
      price: 50,
    });
    const { status, data } = await post({
      operations: [
        {
          operation: 'updateEntity',
          entityType: MockEntityType.PRODUCT,
          entityId: entity.entityId,
          payload: { name: 'after' },
        },
      ],
    });
    expect(status).toBe(200);
    const stored = await entityRepository.getEntity(
      PRODUCT,
      entity.entityId as string,
    );
    expect(stored.data.name).toBe('after');
  });

  it('should adjust entity in transaction', async () => {
    const entity = await entityRepository.createEntity(WALLET, {
      balance: 100,
      minBalance: 0,
    });
    const { status } = await post({
      operations: [
        {
          operation: 'adjustEntity',
          entityType: MockEntityType.WALLET,
          entityId: entity.entityId,
          adjustments: { balance: 50 },
          condition: 'deposit',
        },
      ],
    });
    expect(status).toBe(200);
    const stored = await entityRepository.getEntity(
      WALLET,
      entity.entityId as string,
    );
    expect(stored.data.balance).toBe(150);
  });

  it('should delete entity in transaction', async () => {
    const entity = await entityRepository.createEntity(PRODUCT, {
      name: 'to-delete',
      description: 'test',
      price: 10,
    });
    const { status } = await post({
      operations: [
        {
          operation: 'deleteEntity',
          entityType: MockEntityType.PRODUCT,
          entityId: entity.entityId,
        },
      ],
    });
    expect(status).toBe(200);
    await expect(
      entityRepository.getEntity(PRODUCT, entity.entityId as string),
    ).rejects.toThrow();
  });

  // ─── Multi-operation ─────────────────────────────────────────────────────

  it('should execute mixed operations atomically', async () => {
    const existingWallet = await entityRepository.createEntity(WALLET, {
      balance: 100,
      minBalance: 0,
    });
    const toDelete = await entityRepository.createEntity(PRODUCT, {
      name: 'will-delete',
      description: 'test',
      price: 5,
    });

    const { status, data } = await post({
      operations: [
        {
          operation: 'createEntity',
          entityType: MockEntityType.PRODUCT,
          payload: { name: 'new-product', description: 'test', price: 200 },
        },
        {
          operation: 'adjustEntity',
          entityType: MockEntityType.WALLET,
          entityId: existingWallet.entityId,
          adjustments: { balance: -50 },
          condition: 'withdraw',
        },
        {
          operation: 'deleteEntity',
          entityType: MockEntityType.PRODUCT,
          entityId: toDelete.entityId,
        },
      ],
    });
    expect(status).toBe(200);
    const results = data.results as Array<Record<string, unknown>>;
    expect(results).toHaveLength(3);

    // Verify all effects
    const newProductId = results[0].entityId as string;
    const newProduct = await entityRepository.getEntity(PRODUCT, newProductId);
    expect(newProduct.data.name).toBe('new-product');

    const wallet = await entityRepository.getEntity(
      WALLET,
      existingWallet.entityId as string,
    );
    expect(wallet.data.balance).toBe(50);

    await expect(
      entityRepository.getEntity(PRODUCT, toDelete.entityId as string),
    ).rejects.toThrow();
  });

  // ─── Atomicity ───────────────────────────────────────────────────────────

  it('should roll back all when adjust condition fails', async () => {
    const wallet = await entityRepository.createEntity(WALLET, {
      balance: 30,
      minBalance: 0,
    });

    const { status } = await post({
      operations: [
        {
          operation: 'createEntity',
          entityType: MockEntityType.PRODUCT,
          entityId: 'rollback-test-product',
          payload: { name: 'should-not-exist', description: 'test', price: 1 },
        },
        {
          operation: 'adjustEntity',
          entityType: MockEntityType.WALLET,
          entityId: wallet.entityId,
          adjustments: { balance: -50 },
          condition: 'withdraw',
        },
      ],
    });
    expect(status).toBe(409);

    // Product should NOT exist (rolled back)
    await expect(
      entityRepository.getEntity(PRODUCT, 'rollback-test-product'),
    ).rejects.toThrow();

    // Wallet balance unchanged
    const stored = await entityRepository.getEntity(
      WALLET,
      wallet.entityId as string,
    );
    expect(stored.data.balance).toBe(30);
  });

  it('should roll back all when delete target does not exist', async () => {
    const { status } = await post({
      operations: [
        {
          operation: 'createEntity',
          entityType: MockEntityType.PRODUCT,
          entityId: 'rollback-delete-test',
          payload: { name: 'should-not-exist', description: 'test', price: 1 },
        },
        {
          operation: 'deleteEntity',
          entityType: MockEntityType.PRODUCT,
          entityId: 'nonexistent-entity-id',
        },
      ],
    });
    expect(status).toBe(409);

    await expect(
      entityRepository.getEntity(PRODUCT, 'rollback-delete-test'),
    ).rejects.toThrow();
  });

  // ─── Conditions ──────────────────────────────────────────────────────────

  it('should resolve adjustmentConditions in transaction', async () => {
    const wallet = await entityRepository.createEntity(WALLET, {
      balance: 100,
      minBalance: 10,
    });

    const { status } = await post({
      operations: [
        {
          operation: 'adjustEntity',
          entityType: MockEntityType.WALLET,
          entityId: wallet.entityId,
          adjustments: { balance: -50 },
          condition: 'withdraw',
        },
      ],
    });
    expect(status).toBe(200);

    const stored = await entityRepository.getEntity(
      WALLET,
      wallet.entityId as string,
    );
    expect(stored.data.balance).toBe(50);
  });

  it('should fail when adjustEntity missing required condition', async () => {
    const wallet = await entityRepository.createEntity(WALLET, {
      balance: 100,
    });

    const { status, data } = await post({
      operations: [
        {
          operation: 'adjustEntity',
          entityType: MockEntityType.WALLET,
          entityId: wallet.entityId,
          adjustments: { balance: 10 },
        },
      ],
    });
    expect(status).toBe(400);
    expect(data.code).toBe('INVALID_CONDITION');
  });

  it('should resolve updateConditions in transaction', async () => {
    const wallet = await entityRepository.createEntity(WALLET, {
      balance: 100,
      status: 'draft',
    });

    const { status } = await post({
      operations: [
        {
          operation: 'updateEntity',
          entityType: MockEntityType.WALLET,
          entityId: wallet.entityId,
          payload: { status: 'published' },
          condition: 'publish',
        },
      ],
    });
    expect(status).toBe(200);

    const stored = await entityRepository.getEntity(
      WALLET,
      wallet.entityId as string,
    );
    expect(stored.data.status).toBe('published');
  });

  // ─── Events ──────────────────────────────────────────────────────────────

  it('should publish events after successful transaction', async () => {
    mockPublishEvent.mockClear();

    const wallet = await entityRepository.createEntity(WALLET, {
      balance: 100,
      minBalance: 0,
    });

    const { status } = await post({
      operations: [
        {
          operation: 'createEntity',
          entityType: MockEntityType.PRODUCT,
          payload: { name: 'event-test', description: 'test', price: 10 },
        },
        {
          operation: 'adjustEntity',
          entityType: MockEntityType.WALLET,
          entityId: wallet.entityId,
          adjustments: { balance: 10 },
          condition: 'deposit',
        },
      ],
    });
    expect(status).toBe(200);

    // Should have ENTITY_CREATED + ENTITY_UPDATED events
    const eventTypes = mockPublishEvent.mock.calls.map(
      (call: any) => call[0].event.DetailType,
    );
    expect(eventTypes).toContain('entity-created');
    expect(eventTypes).toContain('entity-updated');
  });

  it('should NOT publish events when transaction fails', async () => {
    mockPublishEvent.mockClear();

    const { status } = await post({
      operations: [
        {
          operation: 'createEntity',
          entityType: MockEntityType.PRODUCT,
          payload: { name: 'no-event', description: 'test', price: 10 },
        },
        {
          operation: 'deleteEntity',
          entityType: MockEntityType.PRODUCT,
          entityId: 'nonexistent-for-event-test',
        },
      ],
    });
    expect(status).toBe(409);
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });

  // ─── Unique fields ─────────────────────────────────────────────────────

  it('should create entity with unique field in transaction', async () => {
    const username = `tx-unique-${Date.now()}`;
    const { status, data } = await post({
      operations: [
        {
          operation: 'createEntity',
          entityType: MockEntityType.USER,
          payload: { name: 'Unique User', username },
        },
      ],
    });
    expect(status).toBe(200);

    const results = data.results as Array<Record<string, unknown>>;
    const entityId = results[0].entityId as string;
    const stored = await entityRepository.getEntity(USER, entityId);
    expect(stored.data.username).toBe(username);
  });

  it('should fail when unique field conflicts in transaction', async () => {
    const username = `tx-conflict-${Date.now()}`;
    await entityRepository.createEntity(USER, {
      name: 'Existing',
      username,
    });

    const { status } = await post({
      operations: [
        {
          operation: 'createEntity',
          entityType: MockEntityType.USER,
          payload: { name: 'Duplicate', username },
        },
      ],
    });
    expect(status).toBe(409);
  });

  // ─── Edge cases ──────────────────────────────────────────────────────────

  it('should fail when creating duplicate entityId in same transaction', async () => {
    const sharedId = `dup-${Date.now()}`;
    const { status } = await post({
      operations: [
        {
          operation: 'createEntity',
          entityType: MockEntityType.PRODUCT,
          entityId: sharedId,
          payload: { name: 'first', description: 'test', price: 1 },
        },
        {
          operation: 'createEntity',
          entityType: MockEntityType.PRODUCT,
          entityId: sharedId,
          payload: { name: 'second', description: 'test', price: 2 },
        },
      ],
    });
    // DynamoDB rejects transactions with duplicate keys
    expect(status).toBe(409);
  });
});
