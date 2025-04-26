import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { Entity as EntityType } from '@monorise/base';
import { ulid } from 'ulid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StandardError } from '../../errors/standard-error';
import {
  MockEntityType,
  StreamHandler,
  createBasicTestTable,
  createDynamoDbClient,
  createMockEntityConfig,
  createReplicationHandler,
  createStreamClient,
  deleteTestTable,
  getTableName,
  replicateData,
  waitForStreamReady,
} from '../../helpers/test/test-utils';
import { DbUtils } from '../DbUtils';
import { type Entity, EntityRepository } from '../Entity';
import { Mutual, MutualRepository } from '../Mutual';

// Dummy data
const now = new Date();

const baseData = {
  byEntityType: MockEntityType.USER as unknown as EntityType,
  byEntityId: 'user-1',
  byData: { name: 'Alice' },
  entityType: MockEntityType.PRODUCT as unknown as EntityType,
  entityId: 'prod-1',
  data: { name: 'Product A', price: 10, description: 'This is a product.' },
  mutualData: { unit: 2 },
  mutualId: 'user-prod-1',
  createdAt: now,
  updatedAt: now,
  mutualUpdatedAt: now,
};

describe('Mutual class', () => {
  it('should instantiate correctly and expose getters', () => {
    const mutual = new Mutual(
      baseData.byEntityType,
      baseData.byEntityId,
      baseData.byData,
      baseData.entityType,
      baseData.entityId,
      baseData.data,
      baseData.mutualData,
      baseData.mutualId,
      baseData.createdAt,
      baseData.updatedAt,
      baseData.mutualUpdatedAt,
    );

    expect(mutual.byFullEntityId).toBe('user#user-1');
    expect(mutual.fullEntityId).toBe('product#prod-1');
    expect(mutual.mainPk).toBe('MUTUAL#user-prod-1');
    expect(mutual.mainSk).toBe('#METADATA#');
    expect(mutual.createdAt).toBe(now.toISOString());
    expect(mutual.data).toEqual(baseData.data);
    expect(mutual.byData).toEqual(baseData.byData);
    expect(mutual.mainKeys()).toEqual({
      PK: { S: 'MUTUAL#user-prod-1' },
      SK: { S: '#METADATA#' },
    });

    expect(mutual.subKeys()).toEqual({
      PK: { S: 'user#user-1' },
      SK: { S: 'product#prod-1' },
    });
  });

  it('should convert toItem and back using fromItem', () => {
    const mutual = new Mutual(
      baseData.byEntityType,
      baseData.byEntityId,
      baseData.byData,
      baseData.entityType,
      baseData.entityId,
      baseData.data,
      baseData.mutualData,
      baseData.mutualId,
      baseData.createdAt,
      baseData.updatedAt,
      baseData.mutualUpdatedAt,
    );
    const item = mutual.toItem();
    const restored = Mutual.fromItem<
      typeof baseData.byEntityType,
      typeof baseData.entityType,
      typeof baseData.mutualData
    >(item);

    expect(restored.byEntityType).toBe(baseData.byEntityType);
    expect(restored.entityType).toBe(baseData.entityType);
    expect(restored.byData).toBeUndefined(); // expected because mutual doesn't store byData
    expect(restored.data).toEqual(baseData.data);
    expect(restored.mutualData).toEqual(baseData.mutualData);
    expect(restored.mutualId).toBe(baseData.mutualId);
  });

  it('should produce toReversedItem with swapped entities', () => {
    const mutual = new Mutual(
      baseData.byEntityType,
      baseData.byEntityId,
      baseData.byData,
      baseData.entityType,
      baseData.entityId,
      baseData.data,
      baseData.mutualData,
      baseData.mutualId,
      baseData.createdAt,
      baseData.updatedAt,
      baseData.mutualUpdatedAt,
    );
    const item = mutual.toReversedItem();
    const parsed = unmarshall(item);
    expect(parsed.byEntityType).toBe('product');
    expect(parsed.byEntityId).toBe('prod-1');
    expect(parsed.entityType).toBe('user');
    expect(parsed.entityId).toBe('user-1');
    expect(parsed.data).toEqual(baseData.byData); // data swapped
  });

  it('should throw error on fromItem(undefined)', () => {
    expect(() => Mutual.fromItem(undefined)).toThrowError(StandardError);
  });
});

// Initialize constants and clients
const TABLE_NAME = getTableName();
const dynamodbClient = createDynamoDbClient();
const streamClient = createStreamClient();
const streamHandler = new StreamHandler(
  TABLE_NAME,
  dynamodbClient,
  streamClient,
);
const mockEntityConfig = createMockEntityConfig();
const EmailAuthEnabledEntities = [MockEntityType.USER];
const replicationHandler = createReplicationHandler(TABLE_NAME, dynamodbClient);

// Create repository instance
const entityRepository = new EntityRepository(
  mockEntityConfig,
  TABLE_NAME,
  dynamodbClient,
  EmailAuthEnabledEntities,
);
const ddbUtils = new DbUtils(dynamodbClient);
const mutualRepository = new MutualRepository(
  TABLE_NAME,
  dynamodbClient,
  ddbUtils,
);

describe('Mutual Repository', () => {
  beforeAll(async () => {
    await createBasicTestTable(TABLE_NAME, dynamodbClient, {
      enableStream: true,
    });
    await waitForStreamReady(TABLE_NAME, dynamodbClient, streamClient);
    await streamHandler.initialize();
  }, 60000); // Increase timeout for table creation

  afterAll(async () => {
    await deleteTestTable(TABLE_NAME, dynamodbClient);
  }, 60000); // Increase timeout for table deletion

  let createdUser: Entity<EntityType>;
  const userData = {
    name: 'Repo Test User',
    email: `test-${ulid()}@example.com`,
  };

  let createdProduct: Entity<EntityType>;
  const productData = {
    name: 'Repo Test Product',
    description: 'This is a product.',
    price: 10,
  };

  it('should create a mutual', async () => {
    createdUser = await entityRepository.createEntity(
      MockEntityType.USER as unknown as EntityType,
      userData,
    );

    createdProduct = await entityRepository.createEntity(
      MockEntityType.PRODUCT as unknown as EntityType,
      productData,
    );

    const createdMutual = await mutualRepository.createMutual(
      createdUser.entityType,
      createdUser.entityId as string,
      createdUser.data,
      createdProduct.entityType,
      createdProduct.entityId as string,
      createdProduct.data,
      { unit: 2 },
    );

    expect(createdMutual).toBeInstanceOf(Mutual);
    expect(createdMutual.entityType).toBe(createdProduct.entityType);
    expect(createdMutual.entityId).toBe(createdProduct.entityId);
    expect(createdMutual.data).toEqual(createdProduct.data);
    expect(createdMutual.mutualData).toEqual({ unit: 2 });
    expect(createdMutual.mutualId).toBeDefined();
    expect(createdMutual.createdAt).toBeDefined();
    expect(createdMutual.updatedAt).toBeDefined();
    expect(createdMutual.mutualUpdatedAt).toBeDefined();
  });

  it('should list product by user', async () => {
    const result = await mutualRepository.listEntitiesByEntity(
      createdUser.entityType,
      createdUser.entityId as string,
      createdProduct.entityType,
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toBeInstanceOf(Mutual);
    expect(result.items[0].entityType).toBe(createdProduct.entityType);
    expect(result.items[0].entityId).toBe(createdProduct.entityId);
    expect(result.items[0].data).toEqual(createdProduct.data);
    expect(result.items[0].mutualData).toEqual({ unit: 2 });
  });

  it('should list user by product', async () => {
    const result = await mutualRepository.listEntitiesByEntity(
      createdProduct.entityType,
      createdProduct.entityId as string,
      createdUser.entityType,
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toBeInstanceOf(Mutual);
    expect(result.items[0].entityType).toBe(createdUser.entityType);
    expect(result.items[0].entityId).toBe(createdUser.entityId);
    expect(result.items[0].data).toEqual(createdUser.data);
    expect(result.items[0].mutualData).toEqual({ unit: 2 });
  });

  it('should update product data when product entity updated', async () => {
    const updatedProductData = {
      ...productData,
      price: 15,
      description: 'Updated product description',
    };

    await entityRepository.updateEntity(
      createdProduct.entityType,
      createdProduct.entityId as string,
      { data: updatedProductData },
    );

    await replicateData(streamHandler, replicationHandler);

    // Get the mutual and verify it has the updated product data
    const updatedMutual = await mutualRepository.getMutual(
      createdUser.entityType,
      createdUser.entityId as string,
      createdProduct.entityType,
      createdProduct.entityId as string,
    );

    expect(updatedMutual.data).toEqual(updatedProductData);
    expect(updatedMutual.data.price).toBe(15);
    expect(updatedMutual.data.description).toBe('Updated product description');
  });

  it('should not be able to list either way when mutual is deleted', async () => {
    // Delete the mutual relationship
    await mutualRepository.deleteMutual(
      createdUser.entityType,
      createdUser.entityId as string,
      createdProduct.entityType,
      createdProduct.entityId as string,
    );

    // Try to list products by user
    const productsResult = await mutualRepository.listEntitiesByEntity(
      createdUser.entityType,
      createdUser.entityId as string,
      createdProduct.entityType,
    );

    // Try to list users by product
    const usersResult = await mutualRepository.listEntitiesByEntity(
      createdProduct.entityType,
      createdProduct.entityId as string,
      createdUser.entityType,
    );

    // Both should return empty arrays
    expect(productsResult.items).toHaveLength(0);
    expect(usersResult.items).toHaveLength(0);

    // Verify mutual is no longer retrievable
    await expect(
      mutualRepository.getMutual(
        createdUser.entityType,
        createdUser.entityId as string,
        createdProduct.entityType,
        createdProduct.entityId as string,
      ),
    ).rejects.toThrow('Mutual item empty');
  });
});
