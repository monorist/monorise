import { Hono } from 'hono';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { Entity as EntityType, createEntityConfig } from '../../../base';
import { setupCommonRoutes } from '../../controllers/setupRoutes';
import {
  MockEntityType,
  StreamHandler,
  createDynamoDbClient,
  createMockEntityConfig,
  createReplicationHandler,
  createStreamClient,
  createTestTable,
  deleteTestTable,
  getTableName,
  replicateData,
  waitForStreamReady,
} from '../../helpers/test/test-utils';
import { DependencyContainer } from '../../services/DependencyContainer';

const TABLE_NAME = getTableName();
const dynamodbClient = createDynamoDbClient();
const streamClient = createStreamClient();
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

const postTransaction = async (body: object): Promise<PostResult> => {
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

const streamHandler = new StreamHandler(
  TABLE_NAME,
  dynamodbClient,
  streamClient,
);
const replicationHandler = createReplicationHandler(TABLE_NAME, dynamodbClient);

describe('Transaction + Processors', () => {
  beforeAll(async () => {
    await createTestTable(TABLE_NAME, dynamodbClient, { enableStream: true });
    await waitForStreamReady(TABLE_NAME, dynamodbClient, streamClient);
    await streamHandler.initialize();
  }, 60000);

  afterAll(async () => {
    await deleteTestTable(TABLE_NAME, dynamodbClient);
  }, 60000);

  // ─── Replication Processor ─────────────────────────────────────────────

  describe('Replication Processor', () => {
    it('should replicate entities created in transaction', async () => {
      const { status, data } = await postTransaction({
        operations: [
          {
            operation: 'createEntity',
            entityType: MockEntityType.PRODUCT,
            payload: {
              name: 'repl-product-1',
              description: 'test',
              price: 10,
            },
          },
          {
            operation: 'createEntity',
            entityType: MockEntityType.PRODUCT,
            payload: {
              name: 'repl-product-2',
              description: 'test',
              price: 20,
            },
          },
        ],
      });
      expect(status).toBe(200);

      const results = data.results as Array<Record<string, unknown>>;
      const id1 = results[0].entityId as string;
      const id2 = results[1].entityId as string;

      // Process stream events
      await replicateData(streamHandler, replicationHandler);

      // Both entities exist
      const entity1 = await entityRepository.getEntity(PRODUCT, id1);
      expect(entity1.data.name).toBe('repl-product-1');
      const entity2 = await entityRepository.getEntity(PRODUCT, id2);
      expect(entity2.data.name).toBe('repl-product-2');

      // Both appear in list (list index created by transaction)
      const listed = await entityRepository.listEntities({
        entityType: PRODUCT,
      });
      const listedIds = listed.items.map((e) => e.entityId);
      expect(listedIds).toContain(id1);
      expect(listedIds).toContain(id2);
    });

    it('should replicate entity updates from transaction', async () => {
      const entity = await entityRepository.createEntity(PRODUCT, {
        name: 'repl-before',
        description: 'test',
        price: 50,
      });

      await replicateData(streamHandler, replicationHandler);

      const { status } = await postTransaction({
        operations: [
          {
            operation: 'updateEntity',
            entityType: MockEntityType.PRODUCT,
            entityId: entity.entityId as string,
            payload: { name: 'repl-after' },
          },
        ],
      });
      expect(status).toBe(200);

      await replicateData(streamHandler, replicationHandler);

      const stored = await entityRepository.getEntity(
        PRODUCT,
        entity.entityId as string,
      );
      expect(stored.data.name).toBe('repl-after');

      const listed = await entityRepository.listEntities({
        entityType: PRODUCT,
      });
      const found = listed.items.find((e) => e.entityId === entity.entityId);
      expect(found).toBeDefined();
      expect((found as any).data.name).toBe('repl-after');
    });

    it('should handle delete in transaction via stream', async () => {
      const entity = await entityRepository.createEntity(PRODUCT, {
        name: 'repl-to-delete',
        description: 'test',
        price: 5,
      });

      await replicateData(streamHandler, replicationHandler);

      const { status } = await postTransaction({
        operations: [
          {
            operation: 'deleteEntity',
            entityType: MockEntityType.PRODUCT,
            entityId: entity.entityId as string,
          },
        ],
      });
      expect(status).toBe(200);

      await replicateData(streamHandler, replicationHandler);

      await expect(
        entityRepository.getEntity(PRODUCT, entity.entityId as string),
      ).rejects.toThrow();
    });
  });

  // ─── Event Publishing (Mutual & Tag Processor) ─────────────────────────

  describe('Event Publishing', () => {
    beforeEach(() => {
      mockPublishEvent.mockClear();
    });

    it('should publish ENTITY_CREATED event with correct shape', async () => {
      const { status, data } = await postTransaction({
        operations: [
          {
            operation: 'createEntity',
            entityType: MockEntityType.PRODUCT,
            payload: {
              name: 'tag-test',
              description: 'for tags',
              price: 100,
            },
          },
        ],
      });
      expect(status).toBe(200);

      const results = data.results as Array<Record<string, unknown>>;
      const entityId = results[0].entityId as string;

      const createdEvent = mockPublishEvent.mock.calls.find(
        (call: any) => call[0].event.DetailType === 'entity-created',
      );
      expect(createdEvent).toBeDefined();

      const payload = createdEvent[0].payload;
      expect(payload.entityType).toBe(MockEntityType.PRODUCT);
      expect(payload.entityId).toBe(entityId);
      expect(payload.data).toBeDefined();
      expect(payload.publishedAt).toBeDefined();
    });

    it('should publish ENTITY_UPDATED event for updateEntity', async () => {
      const entity = await entityRepository.createEntity(PRODUCT, {
        name: 'event-update-test',
        description: 'test',
        price: 50,
      });
      mockPublishEvent.mockClear();

      const { status } = await postTransaction({
        operations: [
          {
            operation: 'updateEntity',
            entityType: MockEntityType.PRODUCT,
            entityId: entity.entityId as string,
            payload: { name: 'event-updated' },
          },
        ],
      });
      expect(status).toBe(200);

      const updatedEvent = mockPublishEvent.mock.calls.find(
        (call: any) => call[0].event.DetailType === 'entity-updated',
      );
      expect(updatedEvent).toBeDefined();
      expect(updatedEvent[0].payload.entityType).toBe(MockEntityType.PRODUCT);
      expect(updatedEvent[0].payload.entityId).toBe(entity.entityId);
      expect(updatedEvent[0].payload.publishedAt).toBeDefined();
    });

    it('should publish ENTITY_DELETED event', async () => {
      const entity = await entityRepository.createEntity(PRODUCT, {
        name: 'event-delete-test',
        description: 'test',
        price: 10,
      });
      mockPublishEvent.mockClear();

      const { status } = await postTransaction({
        operations: [
          {
            operation: 'deleteEntity',
            entityType: MockEntityType.PRODUCT,
            entityId: entity.entityId as string,
          },
        ],
      });
      expect(status).toBe(200);

      const deletedEvent = mockPublishEvent.mock.calls.find(
        (call: any) => call[0].event.DetailType === 'entity-deleted',
      );
      expect(deletedEvent).toBeDefined();
      expect(deletedEvent[0].payload.entityType).toBe(MockEntityType.PRODUCT);
      expect(deletedEvent[0].payload.entityId).toBe(entity.entityId);
    });

    it('should publish multiple events for multi-op transaction', async () => {
      const wallet = await entityRepository.createEntity(WALLET, {
        balance: 100,
        minBalance: 0,
      });
      const toDelete = await entityRepository.createEntity(PRODUCT, {
        name: 'multi-event-del',
        description: 'test',
        price: 5,
      });
      mockPublishEvent.mockClear();

      const { status } = await postTransaction({
        operations: [
          {
            operation: 'createEntity',
            entityType: MockEntityType.PRODUCT,
            payload: {
              name: 'multi-event-create',
              description: 'test',
              price: 1,
            },
          },
          {
            operation: 'adjustEntity',
            entityType: MockEntityType.WALLET,
            entityId: wallet.entityId as string,
            adjustments: { balance: 10 },
            condition: 'deposit',
          },
          {
            operation: 'deleteEntity',
            entityType: MockEntityType.PRODUCT,
            entityId: toDelete.entityId as string,
          },
        ],
      });
      expect(status).toBe(200);

      const eventTypes = mockPublishEvent.mock.calls.map(
        (call: any) => call[0].event.DetailType,
      );
      expect(eventTypes).toContain('entity-created');
      expect(eventTypes).toContain('entity-updated');
      expect(eventTypes).toContain('entity-deleted');
      expect(eventTypes).toHaveLength(3);
    });

    it('should NOT publish events when transaction fails', async () => {
      mockPublishEvent.mockClear();

      await postTransaction({
        operations: [
          {
            operation: 'createEntity',
            entityType: MockEntityType.PRODUCT,
            payload: {
              name: 'no-event',
              description: 'test',
              price: 10,
            },
          },
          {
            operation: 'deleteEntity',
            entityType: MockEntityType.PRODUCT,
            entityId: 'definitely-does-not-exist',
          },
        ],
      });

      expect(mockPublishEvent).not.toHaveBeenCalled();
    });

    it('should publish ENTITY_UPDATED event for adjustEntity', async () => {
      const wallet = await entityRepository.createEntity(WALLET, {
        balance: 100,
        minBalance: 0,
      });
      mockPublishEvent.mockClear();

      const { status } = await postTransaction({
        operations: [
          {
            operation: 'adjustEntity',
            entityType: MockEntityType.WALLET,
            entityId: wallet.entityId as string,
            adjustments: { balance: 25 },
            condition: 'deposit',
          },
        ],
      });
      expect(status).toBe(200);

      const updatedEvent = mockPublishEvent.mock.calls.find(
        (call: any) => call[0].event.DetailType === 'entity-updated',
      );
      expect(updatedEvent).toBeDefined();
      expect(updatedEvent[0].payload.entityType).toBe(MockEntityType.WALLET);
      expect(updatedEvent[0].payload.entityId).toBe(wallet.entityId);
    });
  });
});
