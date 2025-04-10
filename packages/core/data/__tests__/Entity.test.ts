// --- Mock Enum for Testing ---
// This simulates the consumer-generated enum
declare module '@monorise/base' {
  enum Entity {
    USER = 'user',
    PRODUCT = 'product',
  }
}

import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDB,
  waitUntilTableExists,
  waitUntilTableNotExists,
} from '@aws-sdk/client-dynamodb';
import { Entity as EntityType, createEntityConfig } from '@monorise/base';
import { ulid } from 'ulid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod'; // Import z for placeholder schemas
import { Entity, EntityRepository } from '../Entity';

// --- Configuration ---
const TABLE_NAME = `monorise-core-test-${ulid()}`; // Unique table name for test isolation
const LOCALSTACK_ENDPOINT =
  process.env.LOCALSTACK_ENDPOINT || 'http://localhost:4566'; // Or your LocalStack endpoint

// --- Test Setup ---
const dynamodbClient = new DynamoDB({
  endpoint: LOCALSTACK_ENDPOINT,
  region: 'us-east-1', // LocalStack default region
  credentials: {
    accessKeyId: 'test', // LocalStack default credentials
    secretAccessKey: 'test',
  },
});

// Mock Entity Config using EntityType
const mockEntityConfig = {
  [EntityType.USER]: createEntityConfig({
    name: EntityType.USER,
    displayName: 'User',
    // Define baseSchema with all fields potentially accessed in tests as optional
    baseSchema: z.object({
      name: z.string().optional(),
      email: z.string().email().optional(),
      role: z.string().optional(),
      newField: z.string().optional(), // Added from upsert test
      city: z.string().optional(), // Added from queryEntities test
      age: z.number().optional(), // Added from Entity class test
    }),
    searchableFields: ['name', 'email'],
    authMethod: { email: { tokenExpiresIn: 3600000 } }, // Define authMethod for USER
  }),
  [EntityType.PRODUCT]: createEntityConfig({
    name: EntityType.PRODUCT,
    displayName: 'Product',
    // Define baseSchema with all fields potentially accessed in tests as optional
    baseSchema: z.object({
      name: z.string().optional(),
      description: z.string().optional(),
      price: z.number().optional(),
    }),
    searchableFields: ['name', 'description'],
  }),
  // Add minimal placeholders for other expected entities to satisfy the Record type
  [EntityType.ADMIN]: createEntityConfig({
    name: EntityType.ADMIN,
    displayName: 'Admin',
    baseSchema: z.object({}), // Empty schema for placeholder
  }),
  [EntityType.COURSE]: createEntityConfig({
    name: EntityType.COURSE,
    displayName: 'Course',
    baseSchema: z.object({}), // Empty schema for placeholder
  }),
};

const EmailAuthEnabledEntities = [EntityType.USER]; // Use EntityType enum

const entityRepository = new EntityRepository(
  mockEntityConfig,
  TABLE_NAME,
  dynamodbClient,
  EmailAuthEnabledEntities,
);

// --- Helper Functions ---
const createTestTable = async () => {
  const command = new CreateTableCommand({
    TableName: TABLE_NAME,
    KeySchema: [
      { AttributeName: 'PK', KeyType: 'HASH' },
      { AttributeName: 'SK', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: 'S' },
      { AttributeName: 'SK', AttributeType: 'S' },
      { AttributeName: 'R1PK', AttributeType: 'S' }, // For GSI1
      { AttributeName: 'R1SK', AttributeType: 'S' }, // For GSI1
      { AttributeName: 'R2PK', AttributeType: 'S' }, // For GSI2
      { AttributeName: 'R2SK', AttributeType: 'S' }, // For GSI2
    ],
    BillingMode: 'PAY_PER_REQUEST',
    GlobalSecondaryIndexes: [
      // GSI1: For listing entities and email lookups
      {
        IndexName: 'GSI1',
        KeySchema: [
          { AttributeName: 'R1PK', KeyType: 'HASH' },
          { AttributeName: 'R1SK', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
      // GSI2: For mutual relationships (if needed by other parts of your system)
      {
        IndexName: 'GSI2',
        KeySchema: [
          { AttributeName: 'R2PK', KeyType: 'HASH' },
          { AttributeName: 'R2SK', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  });
  await dynamodbClient.send(command);
  await waitUntilTableExists(
    { client: dynamodbClient, maxWaitTime: 30 },
    { TableName: TABLE_NAME },
  );
  console.log(`Test table ${TABLE_NAME} created.`);
};

const deleteTestTable = async () => {
  const command = new DeleteTableCommand({ TableName: TABLE_NAME });
  try {
    await dynamodbClient.send(command);
    await waitUntilTableNotExists(
      { client: dynamodbClient, maxWaitTime: 30 },
      { TableName: TABLE_NAME },
    );
    console.log(`Test table ${TABLE_NAME} deleted.`);
  } catch (error) {
    console.error(`Error deleting table ${TABLE_NAME}:`, error);
    // Handle cases where the table might not exist (e.g., setup failed)
    if ((error as Error).name !== 'ResourceNotFoundException') {
      throw error;
    }
  }
};

// --- Test Suite ---
describe('Entity & EntityRepository', () => {
  beforeAll(async () => {
    await createTestTable();
  }, 60000); // Increase timeout for table creation

  afterAll(async () => {
    await deleteTestTable();
  }, 60000); // Increase timeout for table deletion

  describe('Entity Class', () => {
    it('should correctly initialize and generate keys', () => {
      const userId = ulid();
      const userData = { name: 'Test User', email: 'test@example.com' };
      // Use EntityType enum
      const entity = new Entity(EntityType.USER, userId, userData);

      expect(entity.entityType).toBe(EntityType.USER); // Use EntityType enum
      expect(entity.entityId).toBe(userId);
      expect(entity.data).toEqual(userData);
      expect(entity.pk).toBe(`${EntityType.USER}#${userId}`); // Use EntityType enum
      expect(entity.sk).toBe('#METADATA#');
      expect(entity.listActionKey).toBe(`LIST#${EntityType.USER}`); // Use EntityType enum
      expect(entity.fullId).toBe(`${EntityType.USER}#${userId}`); // Use EntityType enum
      expect(entity.emailKeys).toEqual({
        PK: { S: `EMAIL#${userData.email}` },
        SK: { S: `${EntityType.USER}#${userId}` }, // Use EntityType enum
      });
    });

    it('should convert to and from DynamoDB item format', () => {
      const userId = ulid();
      const now = new Date();
      const userData = {
        name: 'Test User',
        email: 'test@example.com',
        age: 30,
      };
      // Use EntityType enum
      const entity = new Entity<EntityType.USER>(
        EntityType.USER,
        userId,
        userData,
        now,
        now,
      );

      const item = entity.toItem();
      // Basic checks - marshalling adds type info (S, N, etc.)
      expect(item.PK).toEqual({ S: `${EntityType.USER}#${userId}` }); // Use EntityType enum
      expect(item.SK).toEqual({ S: '#METADATA#' });
      expect(item.entityType).toEqual({ S: EntityType.USER }); // Use EntityType enum
      expect(item.entityId).toEqual({ S: userId });
      expect(item.createdAt).toEqual({ S: now.toISOString() });
      expect(item.updatedAt).toEqual({ S: now.toISOString() });
      expect(item.data).toEqual({
        M: {
          name: { S: 'Test User' },
          email: { S: 'test@example.com' },
          age: { N: '30' },
        },
      });

      // Use EntityType enum
      const reconstructedEntity = Entity.fromItem<EntityType.USER>(item);
      expect(reconstructedEntity.entityType).toBe(EntityType.USER); // Use EntityType enum
      expect(reconstructedEntity.entityId).toBe(userId);
      expect(reconstructedEntity.data).toEqual(userData);
      // Date comparison needs care due to potential precision differences
      expect(reconstructedEntity.createdAt).toBe(now.toISOString());
      expect(reconstructedEntity.updatedAt).toBe(now.toISOString());
      expect(reconstructedEntity.pk).toBe(entity.pk);
    });

    it('should handle undefined dates during reconstruction', () => {
      const userId = ulid();
      const userData = { name: 'Test User', email: 'test@example.com' };
      // Use EntityType enum
      const entity = new Entity<EntityType.USER>(
        EntityType.USER,
        userId,
        userData,
      ); // No dates provided

      const item = entity.toItem();
      expect(item.createdAt).toBeUndefined();
      expect(item.updatedAt).toBeUndefined();

      // Use EntityType enum
      const reconstructedEntity = Entity.fromItem<EntityType.USER>(item);
      expect(reconstructedEntity.createdAt).toBeUndefined();
      expect(reconstructedEntity.updatedAt).toBeUndefined();
    });

    it('should throw error if item is undefined in fromItem', () => {
      expect(() => Entity.fromItem(undefined)).toThrow('Entity item empty');
    });
  });

  describe('EntityRepository', () => {
    // Use EntityType enum
    let createdUser: Entity<EntityType.USER>;
    const userEmail = `test-${ulid()}@example.com`;
    const userData = {
      name: 'Repo Test User',
      email: userEmail,
      role: 'admin',
    };

    it('should create an entity successfully', async () => {
      // Use EntityType enum
      createdUser = await entityRepository.createEntity<EntityType.USER>(
        EntityType.USER,
        userData,
      );

      expect(createdUser).toBeInstanceOf(Entity);
      expect(createdUser.entityType).toBe(EntityType.USER); // Use EntityType enum
      expect(createdUser.entityId).toBeDefined();
      expect(createdUser.data).toEqual(userData);
      expect(createdUser.createdAt).toBeDefined();
      expect(createdUser.updatedAt).toBeDefined();
      expect(createdUser.createdAt).toEqual(createdUser.updatedAt); // Should be same on creation

      // Verify directly in DynamoDB (optional but good practice)
      // Use EntityType enum
      const fetched = await entityRepository.getEntity<EntityType.USER>(
        EntityType.USER,
        createdUser.entityId!,
      );
      expect(fetched.entityId).toEqual(createdUser.entityId);
      expect(fetched.data).toEqual(userData);
    });

    it('should fail to create an entity with the same ID', async () => {
      await expect(
        // Use EntityType enum
        entityRepository.createEntity<EntityType.USER>(
          EntityType.USER,
          { name: 'Duplicate', email: 'dup@example.com' },
          createdUser.entityId,
        ),
      ).rejects.toThrow(); // Should throw due to ConditionExpression failure
    });

    it('should fail to create an entity with the same email (if email auth enabled)', async () => {
      await expect(
        // Use EntityType enum
        entityRepository.createEntity<EntityType.USER>(EntityType.USER, {
          name: 'Another User',
          email: userEmail,
        }),
      ).rejects.toThrow(); // Should throw due to email GSI ConditionExpression failure
    });

    it('should get an entity by ID', async () => {
      // Use EntityType enum
      const fetched = await entityRepository.getEntity<EntityType.USER>(
        EntityType.USER,
        createdUser.entityId!,
      );
      expect(fetched.entityId).toEqual(createdUser.entityId);
      expect(fetched.data).toEqual(userData);
      expect(fetched.createdAt).toEqual(createdUser.createdAt);
    });

    it('should throw when getting a non-existent entity by ID', async () => {
      // Use EntityType enum
      await expect(
        entityRepository.getEntity<EntityType.USER>(
          EntityType.USER,
          'non-existent-id',
        ),
      ).rejects.toThrow('Entity item empty');
    });

    it('should get an entity by email', async () => {
      // Use EntityType enum
      const fetched = await entityRepository.getEntityByEmail<EntityType.USER>(
        EntityType.USER,
        userEmail,
      );
      expect(fetched.entityId).toEqual(createdUser.entityId);
      expect(fetched.data).toEqual(userData);
    });

    it('should throw when getting a non-existent entity by email', async () => {
      // Use EntityType enum
      await expect(
        entityRepository.getEntityByEmail<EntityType.USER>(
          EntityType.USER,
          'nobody@example.com',
        ),
      ).rejects.toThrow('Entity item empty');
    });

    it('should confirm email availability for an unused email', async () => {
      // Use EntityType enum
      await expect(
        entityRepository.getEmailAvailability<EntityType.USER>(
          EntityType.USER,
          'available@example.com',
        ),
      ).resolves.toBeUndefined();
    });

    it('should throw when checking email availability for a used email', async () => {
      // Use EntityType enum
      await expect(
        entityRepository.getEmailAvailability<EntityType.USER>(
          EntityType.USER,
          userEmail,
        ),
      ).rejects.toThrow('Email already exists');
    });

    it('should update an entity', async () => {
      const updatedName = 'Repo Test User Updated';
      const updatedData = { name: updatedName };
      const originalUpdatedAt = createdUser.updatedAt;

      // Need a small delay to ensure updatedAt changes
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Use EntityType enum
      const updatedEntity =
        await entityRepository.updateEntity<EntityType.USER>(
          EntityType.USER,
          createdUser.entityId!,
          { data: updatedData },
        );

      expect(updatedEntity.entityId).toEqual(createdUser.entityId);
      expect(updatedEntity.data.name).toEqual(updatedName);
      expect(updatedEntity.data.email).toEqual(userEmail); // Email should remain unchanged
      expect(updatedEntity.updatedAt).toBeDefined();
      expect(updatedEntity.updatedAt).not.toEqual(originalUpdatedAt);
      expect(updatedEntity.createdAt).toEqual(createdUser.createdAt); // CreatedAt should not change

      // Verify directly
      // Use EntityType enum
      const fetched = await entityRepository.getEntity<EntityType.USER>(
        EntityType.USER,
        createdUser.entityId!,
      );
      expect(fetched.data.name).toEqual(updatedName);
      expect(fetched.updatedAt).toEqual(updatedEntity.updatedAt);
    });

    it('should throw when updating a non-existent entity', async () => {
      await expect(
        // Use EntityType enum
        entityRepository.updateEntity<EntityType.USER>(
          EntityType.USER,
          'non-existent-id',
          { data: { name: 'Ghost' } },
        ),
      ).rejects.toThrow('Entity not found');
    });

    it('should upsert an entity (update existing)', async () => {
      const upsertName = 'Repo Test User Upserted';
      const upsertData = { name: upsertName, newField: 'added' };
      const originalUpdatedAt = (
        await entityRepository.getEntity<EntityType.USER>(
          EntityType.USER,
          createdUser.entityId!,
        )
      ).updatedAt;

      await new Promise((resolve) => setTimeout(resolve, 50));

      const upsertedEntity =
        await entityRepository.upsertEntity<EntityType.USER>(
          EntityType.USER,
          createdUser.entityId!,
          upsertData,
        );

      expect(upsertedEntity.entityId).toEqual(createdUser.entityId);
      expect(upsertedEntity.data.name).toEqual(upsertName);
      expect(upsertedEntity.data.email).toEqual(userEmail); // Should merge, not replace
      expect((upsertedEntity.data as any).newField).toEqual('added');
      expect(upsertedEntity.updatedAt).not.toEqual(originalUpdatedAt);

      // Verify directly
      const fetched = await entityRepository.getEntity<EntityType.USER>(
        EntityType.USER,
        createdUser.entityId!,
      );
      expect(fetched.data.name).toEqual(upsertName);
      expect((fetched.data as any).newField).toEqual('added');
    });

    it('should upsert an entity (create new)', async () => {
      const newUserId = ulid();
      const newUserData = {
        name: 'New Upsert User',
        email: `new-${newUserId}@example.com`,
      };

      const upsertedEntity =
        await entityRepository.upsertEntity<EntityType.USER>(
          EntityType.USER,
          newUserId,
          newUserData,
        );

      expect(upsertedEntity.entityId).toEqual(newUserId);
      expect(upsertedEntity.data).toEqual(newUserData);
      expect(upsertedEntity.createdAt).toBeDefined(); // Should be set on creation
      expect(upsertedEntity.updatedAt).toBeDefined();

      // Verify directly
      const fetched = await entityRepository.getEntity<EntityType.USER>(
        EntityType.USER,
        newUserId,
      );
      expect(fetched.data).toEqual(newUserData);

      // Clean up the newly created user for subsequent tests
      await entityRepository.deleteEntity(EntityType.USER, newUserId);
    });

    describe('listEntities', () => {
      const productIds: string[] = [];
      beforeAll(async () => {
        // Create some products for listing
        for (let i = 1; i <= 7; i++) {
          const product =
            await entityRepository.createEntity<EntityType.PRODUCT>(
              EntityType.PRODUCT,
              {
                name: `Test Product ${i}`,
                description: `Description for product ${i}`,
                price: i * 10,
              },
            );
          productIds.push(product.entityId!);
        }
      });

      afterAll(async () => {
        // Clean up products
        for (const id of productIds) {
          try {
            await entityRepository.deleteEntity(EntityType.PRODUCT, id);
          } catch (e) {
            // Ignore if already deleted or not found
          }
        }
      });

      it('should list all entities of a type', async () => {
        const { items, totalCount } =
          await entityRepository.listEntities<EntityType.PRODUCT>({
            entityType: EntityType.PRODUCT,
          });
        // Note: totalCount from listEntities only counts items retrieved in *that specific call*
        // A full count would require iterating through all pages if paginated.
        // Here, since we expect few items and no limit, it should match.
        expect(items.length).toBe(7);
        expect(totalCount).toBe(7);
        expect(items[0].entityType).toBe(EntityType.PRODUCT);
      });

      it('should list entities with a limit', async () => {
        const limit = 3;
        const { items, totalCount, lastKey } =
          await entityRepository.listEntities<EntityType.PRODUCT>({
            entityType: EntityType.PRODUCT,
            limit: limit,
          });
        expect(items.length).toBe(limit);
        expect(totalCount).toBe(limit);
        expect(lastKey).toBeDefined(); // Expect pagination key
      });

      it('should list entities with pagination (using lastKey)', async () => {
        const limit = 4;
        const firstPage =
          await entityRepository.listEntities<EntityType.PRODUCT>({
            entityType: EntityType.PRODUCT,
            limit: limit,
          });
        expect(firstPage.items.length).toBe(limit);
        expect(firstPage.lastKey).toBeDefined();

        const secondPage =
          await entityRepository.listEntities<EntityType.PRODUCT>({
            entityType: EntityType.PRODUCT,
            limit: limit, // Request same limit again
            options: { lastKey: firstPage.lastKey },
          });
        expect(secondPage.items.length).toBe(7 - limit); // Remaining items
        expect(secondPage.lastKey).toBeUndefined(); // Should be the last page

        // Combine and check uniqueness
        const allIds = [...firstPage.items, ...secondPage.items].map(
          (it) => it.entityId,
        );
        expect(new Set(allIds).size).toBe(7);
      });

      it('should list entities between a range (using entityId)', async () => {
        // Assuming ULIDs are roughly sortable lexicographically for this test
        const sortedIds = [...productIds].sort();
        const startId = sortedIds[1]; // Second item
        const endId = sortedIds[4]; // Fifth item (inclusive range expected based on implementation)

        const { items, totalCount } =
          await entityRepository.listEntities<EntityType.PRODUCT>({
            entityType: EntityType.PRODUCT,
            between: { start: startId, end: endId },
          });

        // The number of items depends on the exact ULIDs generated.
        // We expect items whose IDs fall lexicographically between startId and endId.
        // This is a less reliable test due to ULID nature but demonstrates the 'between' usage.
        expect(items.length).toBeGreaterThanOrEqual(1); // At least the startId should match if it exists
        expect(items.length).toBeLessThanOrEqual(4); // Max items in this range example
        expect(totalCount).toEqual(items.length);

        // Verify items are within the expected range
        for (const item of items) {
          expect(item.entityId! >= startId).toBe(true);
          expect(item.entityId! <= endId).toBe(true);
        }
      });

      it('should list entities with ProjectionExpression', async () => {
        const { items } =
          await entityRepository.listEntities<EntityType.PRODUCT>({
            entityType: EntityType.PRODUCT,
            limit: 1,
            options: {
              ProjectionExpression: 'entityId, data.name' as any,
              ExpressionAttributeNames: {
                '#entityId': 'entityId',
                '#data': 'data',
                '#name': 'name',
              },
            },
          });
        expect(items.length).toBe(1);
        const itemData = items[0].data as any;
        expect(itemData.name).toBeDefined();
        expect(itemData.description).toBeUndefined(); // Should not be projected
        expect(itemData.price).toBeUndefined(); // Should not be projected
        expect(items[0].entityId).toBeDefined();
        expect(items[0].entityType).toBeUndefined(); // Not projected
        expect(items[0].createdAt).toBeUndefined(); // Not projected
      });
    });

    describe('queryEntities', () => {
      const user1Data = {
        name: 'Alice Smith',
        email: `alice-${ulid()}@example.com`,
        city: 'New York',
      };
      const user2Data = {
        name: 'Bob Johnson',
        email: `bob-${ulid()}@example.com`,
        city: 'London',
      };
      const user3Data = {
        name: 'Charlie Smith',
        email: `charlie-${ulid()}@example.com`,
        city: 'New York',
      };
      let user1: Entity<EntityType.USER>;
      let user2: Entity<EntityType.USER>;
      let user3: Entity<EntityType.USER>;

      beforeAll(async () => {
        user1 = await entityRepository.createEntity<EntityType.USER>(
          EntityType.USER,
          user1Data,
        );
        user2 = await entityRepository.createEntity<EntityType.USER>(
          EntityType.USER,
          user2Data,
        );
        user3 = await entityRepository.createEntity<EntityType.USER>(
          EntityType.USER,
          user3Data,
        );
      });

      afterAll(async () => {
        await entityRepository.deleteEntity(EntityType.USER, user1.entityId!);
        await entityRepository.deleteEntity(EntityType.USER, user2.entityId!);
        await entityRepository.deleteEntity(EntityType.USER, user3.entityId!);
      });

      it('should find entities matching a name fragment (case-insensitive)', async () => {
        const { items, totalCount, filteredCount } =
          await entityRepository.queryEntities<EntityType.USER>(
            EntityType.USER,
            'smith',
          );
        // totalCount reflects all USER entities before filtering
        expect(totalCount).toBeGreaterThanOrEqual(3); // Includes the user from the main describe block + 3 here
        expect(filteredCount).toBe(2);
        expect(items.length).toBe(2);
        const names = items.map((i) => i.data.name);
        expect(names).toContain('Alice Smith');
        expect(names).toContain('Charlie Smith');
      });

      it('should find entities matching an email fragment', async () => {
        const { items, filteredCount } =
          await entityRepository.queryEntities<EntityType.USER>(
            EntityType.USER,
            'bob-',
          );
        expect(filteredCount).toBe(1);
        expect(items.length).toBe(1);
        expect(items[0].data.name).toBe('Bob Johnson');
      });

      it('should return empty results for no match', async () => {
        const { items, filteredCount } =
          await entityRepository.queryEntities<EntityType.USER>(
            EntityType.USER,
            'nonexistent',
          );
        expect(filteredCount).toBe(0);
        expect(items.length).toBe(0);
      });

      it('should return all items for an empty query', async () => {
        // The current implementation might treat empty query differently,
        // but typically it should return all or none based on regex.
        // An empty regex matches everything.
        const { items, totalCount, filteredCount } =
          await entityRepository.queryEntities<EntityType.USER>(
            EntityType.USER,
            '',
          );
        expect(filteredCount).toEqual(totalCount); // Empty query matches all
        expect(items.length).toEqual(totalCount);
      });

      it('should handle invalid regex gracefully', async () => {
        // Example of invalid regex pattern
        const { items, totalCount, filteredCount } =
          await entityRepository.queryEntities<EntityType.USER>(
            EntityType.USER,
            '+',
          );
        expect(filteredCount).toBe(0); // Expect no matches for invalid regex
        expect(items.length).toBe(0);
        // totalCount might still reflect the initial list count before filtering attempt
        expect(totalCount).toBeGreaterThanOrEqual(3);
      });
    });

    it('should delete an entity', async () => {
      // Create a temporary entity to delete
      const tempUser = await entityRepository.createEntity<EntityType.USER>(
        EntityType.USER,
        { name: 'To Delete', email: `delete-${ulid()}@example.com` },
      );
      expect(tempUser.entityId).toBeDefined();

      // Delete it
      await entityRepository.deleteEntity(EntityType.USER, tempUser.entityId!);

      // Verify it's gone
      await expect(
        entityRepository.getEntity<EntityType.USER>(
          EntityType.USER,
          tempUser.entityId!,
        ),
      ).rejects.toThrow('Entity item empty');

      // Also try deleting the main test user created at the start of this block
      await entityRepository.deleteEntity(
        EntityType.USER,
        createdUser.entityId!,
      );
      await expect(
        entityRepository.getEntity<EntityType.USER>(
          EntityType.USER,
          createdUser.entityId!,
        ),
      ).rejects.toThrow('Entity item empty');
      // Verify email GSI record is also gone (implicitly tested by trying to create user with same email again)
      await expect(
        entityRepository.getEmailAvailability<EntityType.USER>(
          EntityType.USER,
          userEmail,
        ),
      ).resolves.toBeUndefined();
    });

    it('should throw when deleting a non-existent entity', async () => {
      await expect(
        entityRepository.deleteEntity(EntityType.USER, 'non-existent-id'),
      ).rejects.toThrow('Entity not found');
    });
  });
});
