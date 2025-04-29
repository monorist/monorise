// --- Mock Enum for Testing ---
// This simulates the consumer-generated enum
declare module '@monorise/base' {
  interface EntitySchemaMap {
    user: {
      name: string;
      email: string;
      role: string;
      username: string;
      age: number;
    };
    product: { name: string };
    // admin: { name: string };
    // course: { name: string };
  }
}

import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDB,
  waitUntilTableExists,
  waitUntilTableNotExists,
} from '@aws-sdk/client-dynamodb';
import { type Entity as EntityType, createEntityConfig } from '../../../base';
import { ulid } from 'ulid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod'; // Import z for placeholder schemas
import { Entity, EntityRepository } from '../Entity';

enum MockEntityType {
  USER = 'user',
  PRODUCT = 'product',
  ADMIN = 'admin',
  COURSE = 'course',
}

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

// Mock Entity Config using MockEntityType
const mockEntityConfig = {
  [MockEntityType.USER]: createEntityConfig({
    name: MockEntityType.USER,
    displayName: 'User',
    // Define baseSchema with all fields potentially accessed in tests as optional
    baseSchema: z
      .object({
        name: z.string(),
        email: z.string().email(),
        role: z.string(),
        newField: z.string(), // Added from upsert test
        city: z.string(), // Added from queryEntities test
        age: z.number(), // Added from Entity class test
        username: z.string(),
      })
      .partial(),
    createSchema: z.object({
      name: z.string(),
      username: z.string(),
    }),
    uniqueFields: ['username'],
    searchableFields: ['name', 'email'],
    authMethod: { email: { tokenExpiresIn: 3600000 } }, // Define authMethod for USER
  }),
  [MockEntityType.PRODUCT]: createEntityConfig({
    name: MockEntityType.PRODUCT,
    displayName: 'Product',
    // Define baseSchema with all fields potentially accessed in tests as optional
    baseSchema: z.object({
      name: z.string(),
      description: z.string(),
      price: z.number(),
    }),
    searchableFields: ['name', 'description'],
  }),
  // Add minimal placeholders for other expected entities to satisfy the Record type
  [MockEntityType.ADMIN]: createEntityConfig({
    name: MockEntityType.ADMIN,
    displayName: 'Admin',
    baseSchema: z.object({}), // Empty schema for placeholder
  }),
  [MockEntityType.COURSE]: createEntityConfig({
    name: MockEntityType.COURSE,
    displayName: 'Course',
    baseSchema: z.object({}), // Empty schema for placeholder
  }),
};

const EmailAuthEnabledEntities = [MockEntityType.USER]; // Use MockEntityType enum

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
      // Use MockEntityType enum
      const entity = new Entity(
        MockEntityType.USER as unknown as EntityType,
        userId,
        userData,
      );

      expect(entity.entityType).toBe(MockEntityType.USER); // Use MockEntityType enum
      expect(entity.entityId).toBe(userId);
      expect(entity.data).toEqual(userData);
      expect(entity.pk).toBe(`${MockEntityType.USER}#${userId}`); // Use MockEntityType enum
      expect(entity.sk).toBe('#METADATA#');
      expect(entity.listActionKey).toBe(`LIST#${MockEntityType.USER}`); // Use MockEntityType enum
      expect(entity.fullId).toBe(`${MockEntityType.USER}#${userId}`); // Use MockEntityType enum
      expect(entity.emailKeys).toEqual({
        PK: { S: `EMAIL#${userData.email}` },
        SK: { S: `${MockEntityType.USER}#${userId}` }, // Use MockEntityType enum
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
      // Use MockEntityType enum
      const entity = new Entity(
        MockEntityType.USER as unknown as EntityType,
        userId,
        userData,
        now,
        now,
      );

      const item = entity.toItem();
      // Basic checks - marshalling adds type info (S, N, etc.)
      expect(item.PK).toEqual({ S: `${MockEntityType.USER}#${userId}` }); // Use MockEntityType enum
      expect(item.SK).toEqual({ S: '#METADATA#' });
      expect(item.entityType).toEqual({ S: MockEntityType.USER }); // Use MockEntityType enum
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

      // Use MockEntityType enum
      const reconstructedEntity = Entity.fromItem(item);
      expect(reconstructedEntity.entityType).toBe(MockEntityType.USER); // Use MockEntityType enum
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
      // Use MockEntityType enum
      const entity = new Entity(
        MockEntityType.USER as unknown as EntityType,
        userId,
        userData,
      ); // No dates provided

      const item = entity.toItem();
      expect(item.createdAt).toBeUndefined();
      expect(item.updatedAt).toBeUndefined();

      // Use MockEntityType enum
      const reconstructedEntity = Entity.fromItem(item);
      expect(reconstructedEntity.createdAt).toBeUndefined();
      expect(reconstructedEntity.updatedAt).toBeUndefined();
    });

    it('should throw error if item is undefined in fromItem', () => {
      expect(() => Entity.fromItem(undefined)).toThrow('Entity item empty');
    });
  });

  describe('EntityRepository', () => {
    // Use MockEntityType enum
    let createdUser: Entity<EntityType>;
    const userEmail = `test-${ulid()}@example.com`;
    const username = `test-${ulid()}`;
    const userData = {
      name: 'Repo Test User',
      email: userEmail,
      role: 'admin',
      username: username,
    };

    it('should create an entity successfully', async () => {
      // Use MockEntityType enum
      createdUser = await entityRepository.createEntity(
        MockEntityType.USER as unknown as EntityType,
        userData,
        undefined,
      );

      expect(createdUser).toBeInstanceOf(Entity);
      expect(createdUser.entityType).toBe(MockEntityType.USER); // Use MockEntityType enum
      expect(createdUser.entityId).toBeDefined();
      expect(createdUser.data).toEqual(userData);
      expect(createdUser.createdAt).toBeDefined();
      expect(createdUser.updatedAt).toBeDefined();
      expect(createdUser.createdAt).toEqual(createdUser.updatedAt); // Should be same on creation

      // Verify directly in DynamoDB (optional but good practice)
      // Use MockEntityType enum
      const fetched = await entityRepository.getEntity(
        MockEntityType.USER as unknown as EntityType,
        createdUser.entityId!,
      );
      expect(fetched.entityId).toEqual(createdUser.entityId);
      expect(fetched.data).toEqual(userData);
    });

    it('should fail to create an entity with the same ID', async () => {
      await expect(
        // Use MockEntityType enum
        entityRepository.createEntity(
          MockEntityType.USER as unknown as EntityType,
          { name: 'Duplicate', email: 'dup@example.com' },
          createdUser.entityId,
        ),
      ).rejects.toThrow(); // Should throw due to ConditionExpression failure
    });

    it('should fail to create an entity with existing unique field value', async () => {
      await expect(
        // Use MockEntityType enum
        entityRepository.createEntity(
          MockEntityType.USER as unknown as EntityType,
          { name: 'Duplicate', username: createdUser.data.username },
          createdUser.entityId,
        ),
      ).rejects.toThrow(); // Should throw due to ConditionExpression failure
    });

    it('should fail to create an entity when unique field value is not string', async () => {
      await expect(
        // Use MockEntityType enum
        entityRepository.createEntity(
          MockEntityType.USER as unknown as EntityType,
          { name: 'Invalid record', username: ['123', '456'] },
          createdUser.entityId,
        ),
      ).rejects.toThrow(); // Should throw due to ConditionExpression failure
    });

    // TODO FIXME: due to different PK and SK during account creation, idempotency check is failed
    // to fix this, we should make sure SK is not dynamic for email creation
    // it('should fail to create an entity with the same email (if email auth enabled)', async () => {
    //   await expect(
    //     // Use MockEntityType enum
    //     entityRepository.createEntity(
    //       MockEntityType.USER as unknown as EntityType,
    //       {
    //         name: 'Another User',
    //         email: userEmail,
    //       },
    //     ),
    //   ).rejects.toThrow(); // Should throw due to email GSI ConditionExpression failure
    // });

    it('should get an entity by ID', async () => {
      // Use MockEntityType enum
      const fetched = await entityRepository.getEntity(
        MockEntityType.USER as unknown as EntityType,
        createdUser.entityId!,
      );
      expect(fetched.entityId).toEqual(createdUser.entityId);
      expect(fetched.data).toEqual(userData);
      expect(fetched.createdAt).toEqual(createdUser.createdAt);
    });

    it('should throw when getting a non-existent entity by ID', async () => {
      // Use MockEntityType enum
      await expect(
        entityRepository.getEntity(
          MockEntityType.USER as unknown as EntityType,
          'non-existent-id',
        ),
      ).rejects.toThrow('Entity item empty');
    });

    it('should get an entity by email', async () => {
      // Use MockEntityType enum
      const fetched = await entityRepository.getEntityByEmail(
        MockEntityType.USER as unknown as EntityType,
        userEmail,
      );
      expect(fetched.entityId).toEqual(createdUser.entityId);
      expect(fetched.data).toEqual(userData);
    });

    it('should throw when getting a non-existent entity by email', async () => {
      // Use MockEntityType enum
      await expect(
        entityRepository.getEntityByEmail(
          MockEntityType.USER as unknown as EntityType,
          'nobody@example.com',
        ),
      ).rejects.toThrow('Entity item empty');
    });

    it('should confirm email availability for an unused email', async () => {
      // Use MockEntityType enum
      await expect(
        entityRepository.getEmailAvailability(
          MockEntityType.USER as unknown as EntityType,
          'available@example.com',
        ),
      ).resolves.toBeUndefined();
    });

    it('should throw when checking email availability for a used email', async () => {
      // Use MockEntityType enum
      await expect(
        entityRepository.getEmailAvailability(
          MockEntityType.USER as unknown as EntityType,
          userEmail,
        ),
      ).rejects.toThrow('Email already exists');
    });

    it('should get an entity by unique field', async () => {
      const fetched = await entityRepository.getEntityByUniqueField(
        MockEntityType.USER as unknown as EntityType,
        'username',
        username,
      );

      expect(fetched.entityId).toEqual(createdUser.entityId);
      expect(fetched.data).toEqual(userData);
    });

    it('should confirm unique field availability for an unused unique field value', async () => {
      await expect(
        entityRepository.getUniqueFieldValueAvailability(
          MockEntityType.USER as unknown as EntityType,
          'username',
          'unused-username',
        ),
      ).resolves.toBeUndefined();
    });

    it('should throw when checking unique field value for a used value', async () => {
      await expect(
        entityRepository.getUniqueFieldValueAvailability(
          MockEntityType.USER as unknown as EntityType,
          'username',
          username,
        ),
      ).rejects.toThrow(`username '${username}' already exists`);
    });

    it('should update an entity with unique fields', async () => {
      const updatedName = 'Repo Test User Updated';
      const updatedUsername = 'updated-username';
      const updatedData = { name: updatedName, username: updatedUsername };
      const originalUpdatedAt = createdUser.updatedAt;

      // Need a small delay to ensure updatedAt changes
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Use MockEntityType enum
      const updatedEntity = await entityRepository.updateEntity(
        MockEntityType.USER as unknown as EntityType,
        createdUser.entityId as string,
        { data: updatedData },
      );

      expect(updatedEntity.entityId).toEqual(createdUser.entityId);
      expect(updatedEntity.data.name).toEqual(updatedName);
      expect(updatedEntity.data.email).toEqual(userEmail); // Email should remain unchanged
      expect(updatedEntity.data.username).toEqual(updatedUsername);
      expect(updatedEntity.updatedAt).toBeDefined();
      expect(updatedEntity.updatedAt).not.toEqual(originalUpdatedAt);
      expect(updatedEntity.createdAt).toEqual(createdUser.createdAt); // CreatedAt should not change

      // Verify directly
      // Use MockEntityType enum
      const fetched = await entityRepository.getEntity(
        MockEntityType.USER as unknown as EntityType,
        createdUser.entityId as string,
      );
      expect(fetched.data.name).toEqual(updatedName);
      expect(fetched.updatedAt).toEqual(updatedEntity.updatedAt);
    });

    it('should throw when updating a non-existent entity', async () => {
      await expect(
        // Use MockEntityType enum
        entityRepository.updateEntity(
          MockEntityType.USER as unknown as EntityType,
          'non-existent-id',
          {
            data: { name: 'Ghost' },
          },
        ),
      ).rejects.toThrow('Entity not found');
    });

    it('should get an entity by updated unique field', async () => {
      const fetched = await entityRepository.getEntityByUniqueField(
        MockEntityType.USER as unknown as EntityType,
        'username',
        'updated-username',
      );

      expect(fetched.entityId).toEqual(createdUser.entityId);
      expect(fetched.data).toEqual({
        ...userData,
        username: 'updated-username',
        name: 'Repo Test User Updated',
      });
    });

    it('should confirm unique field availability for an previous unique field value', async () => {
      await expect(
        entityRepository.getUniqueFieldValueAvailability(
          MockEntityType.USER as unknown as EntityType,
          'username',
          username,
        ),
      ).resolves.toBeUndefined();
    });

    it('should throw when checking unique field value for a used value (updated)', async () => {
      await expect(
        entityRepository.getUniqueFieldValueAvailability(
          MockEntityType.USER as unknown as EntityType,
          'username',
          'updated-username',
        ),
      ).rejects.toThrow(`username 'updated-username' already exists`);
    });

    it('should update an entity without changing unique fields', async () => {
      const updatedAge = 99;
      const updatedData = { age: updatedAge };
      const originalUpdatedAt = createdUser.updatedAt;

      // Need a small delay to ensure updatedAt changes
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Use MockEntityType enum
      const updatedEntity = await entityRepository.updateEntity(
        MockEntityType.USER as unknown as EntityType,
        createdUser.entityId as string,
        { data: updatedData },
      );

      expect(updatedEntity.entityId).toEqual(createdUser.entityId);
      expect(updatedEntity.data.name).toEqual('Repo Test User Updated');
      expect(updatedEntity.data.email).toEqual(userEmail); // Email should remain unchanged
      expect(updatedEntity.data.username).toEqual('updated-username');
      expect(updatedEntity.data.age).toEqual(updatedAge);
      expect(updatedEntity.updatedAt).toBeDefined();
      expect(updatedEntity.updatedAt).not.toEqual(originalUpdatedAt);
      expect(updatedEntity.createdAt).toEqual(createdUser.createdAt); // CreatedAt should not change

      // Verify directly
      // Use MockEntityType enum
      const fetched = await entityRepository.getEntity(
        MockEntityType.USER as unknown as EntityType,
        createdUser.entityId as string,
      );
      expect(fetched.data.age).toEqual(updatedAge);
      expect(fetched.updatedAt).toEqual(updatedEntity.updatedAt);
    });

    it('should get an entity by updated unique field', async () => {
      const fetched = await entityRepository.getEntityByUniqueField(
        MockEntityType.USER as unknown as EntityType,
        'username',
        'updated-username',
      );

      expect(fetched.entityId).toEqual(createdUser.entityId);
      expect(fetched.data).toEqual({
        ...userData,
        username: 'updated-username',
        name: 'Repo Test User Updated',
      });
    });

    it('should confirm unique field availability for an previous unique field value', async () => {
      await expect(
        entityRepository.getUniqueFieldValueAvailability(
          MockEntityType.USER as unknown as EntityType,
          'username',
          username,
        ),
      ).resolves.toBeUndefined();
    });

    it('should throw when checking unique field value for a used value (updated)', async () => {
      await expect(
        entityRepository.getUniqueFieldValueAvailability(
          MockEntityType.USER as unknown as EntityType,
          'username',
          'updated-username',
        ),
      ).rejects.toThrow(`username 'updated-username' already exists`);
    });

    it('should upsert an entity (update existing)', async () => {
      const upsertName = 'Repo Test User Upserted';
      const upsertData = { name: upsertName, newField: 'added' };
      const originalUpdatedAt = (
        await entityRepository.getEntity(
          MockEntityType.USER as unknown as EntityType,
          createdUser.entityId ?? '',
        )
      ).updatedAt;

      await new Promise((resolve) => setTimeout(resolve, 50));

      const upsertedEntity = await entityRepository.upsertEntity(
        MockEntityType.USER as unknown as EntityType,
        createdUser.entityId!,
        upsertData,
      );

      expect(upsertedEntity.entityId).toEqual(createdUser.entityId);
      expect(upsertedEntity.data.name).toEqual(upsertName);
      expect(upsertedEntity.data.email).toEqual(userEmail); // Should merge, not replace
      expect(upsertedEntity.data.newField).toEqual('added');
      expect(upsertedEntity.updatedAt).not.toEqual(originalUpdatedAt);

      // Verify directly
      const fetched = await entityRepository.getEntity(
        MockEntityType.USER as unknown as EntityType,
        createdUser.entityId ?? '',
      );
      expect(fetched.data.name).toEqual(upsertName);
      expect((fetched.data as any).newField).toEqual('added');
    });

    // TODO FIX ME: upsertEntity doesn't create entity
    // it('should upsert an entity (create new)', async () => {
    //   const newUserId = ulid();
    //   const newUserData = {
    //     name: 'New Upsert User',
    //     email: `new-${newUserId}@example.com`,
    //   };
    //
    //   const upsertedEntity = await entityRepository.upsertEntity(
    //     MockEntityType.USER as unknown as EntityType,
    //     newUserId,
    //     newUserData,
    //   );
    //
    //   expect(upsertedEntity.entityId).toEqual(newUserId);
    //   expect(upsertedEntity.data).toEqual(newUserData);
    //   expect(upsertedEntity.createdAt).toBeDefined(); // Should be set on creation
    //   expect(upsertedEntity.updatedAt).toBeDefined();
    //
    //   // Verify directly
    //   const fetched = await entityRepository.getEntity(
    //     MockEntityType.USER as unknown as EntityType,
    //     newUserId,
    //   );
    //   expect(fetched.data).toEqual(newUserData);
    //
    //   // Clean up the newly created user for subsequent tests
    //   await entityRepository.deleteEntity(MockEntityType.USER as unknown as EntityType, newUserId);
    // });

    describe('listEntities', () => {
      const productIds: string[] = [];
      beforeAll(async () => {
        // Create some products for listing
        for (let i = 1; i <= 7; i++) {
          const product = await entityRepository.createEntity(
            MockEntityType.PRODUCT as unknown as EntityType,
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
            await entityRepository.deleteEntity(
              MockEntityType.PRODUCT as unknown as EntityType,
              id,
            );
          } catch (e) {
            // Ignore if already deleted or not found
          }
        }
      });

      it('should list all entities of a type', async () => {
        const { items, totalCount } = await entityRepository.listEntities({
          entityType: MockEntityType.PRODUCT as unknown as EntityType,
        });
        // Note: totalCount from listEntities only counts items retrieved in *that specific call*
        // A full count would require iterating through all pages if paginated.
        // Here, since we expect few items and no limit, it should match.
        expect(items.length).toBe(7);
        expect(totalCount).toBe(7);
        expect(items[0].entityType).toBe(MockEntityType.PRODUCT);
      });

      it('should list entities with a limit', async () => {
        const limit = 3;
        const { items, totalCount, lastKey } =
          await entityRepository.listEntities({
            entityType: MockEntityType.PRODUCT as unknown as EntityType,
            limit: limit,
          });
        expect(items.length).toBe(limit);
        expect(totalCount).toBe(limit);
        expect(lastKey).toBeDefined(); // Expect pagination key
      });

      it('should list entities with pagination (using lastKey)', async () => {
        const limit = 4;
        const firstPage = await entityRepository.listEntities({
          entityType: MockEntityType.PRODUCT as unknown as EntityType,
          limit: limit,
        });
        expect(firstPage.items.length).toBe(limit);
        expect(firstPage.lastKey).toBeDefined();

        const secondPage = await entityRepository.listEntities({
          entityType: MockEntityType.PRODUCT as unknown as EntityType,
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

        const { items, totalCount } = await entityRepository.listEntities({
          entityType: MockEntityType.PRODUCT as unknown as EntityType,
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
        const { items } = await entityRepository.listEntities({
          entityType: MockEntityType.PRODUCT as unknown as EntityType,
          limit: 1,
          options: {
            ProjectionExpression: 'entityId' as any,
          },
        });
        expect(items.length).toBe(1);
        expect(items[0].entityId).toBeDefined();
        expect(items[0].entityType).toBeUndefined(); // Not projected
        expect(items[0].createdAt).toBeUndefined(); // Not projected
        expect(items[0].data).toMatchObject({}); // Not projected
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
      let user1: Entity;
      let user2: Entity;
      let user3: Entity;

      beforeAll(async () => {
        user1 = await entityRepository.createEntity(
          MockEntityType.USER as unknown as EntityType,
          user1Data,
        );
        user2 = await entityRepository.createEntity(
          MockEntityType.USER as unknown as EntityType,
          user2Data,
        );
        user3 = await entityRepository.createEntity(
          MockEntityType.USER as unknown as EntityType,
          user3Data,
        );
      });

      afterAll(async () => {
        await entityRepository.deleteEntity(
          MockEntityType.USER as unknown as EntityType,
          user1.entityId!,
        );
        await entityRepository.deleteEntity(
          MockEntityType.USER as unknown as EntityType,
          user2.entityId!,
        );
        await entityRepository.deleteEntity(
          MockEntityType.USER as unknown as EntityType,
          user3.entityId!,
        );
      });

      it('should find entities matching a name fragment (case-insensitive)', async () => {
        const { items, totalCount, filteredCount } =
          await entityRepository.queryEntities(
            MockEntityType.USER as unknown as EntityType,
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
        const { items, filteredCount } = await entityRepository.queryEntities(
          MockEntityType.USER as unknown as EntityType,
          'bob-',
        );
        expect(filteredCount).toBe(1);
        expect(items.length).toBe(1);
        expect(items[0].data.name).toBe('Bob Johnson');
      });

      it('should return empty results for no match', async () => {
        const { items, filteredCount } = await entityRepository.queryEntities(
          MockEntityType.USER as unknown as EntityType,
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
          await entityRepository.queryEntities(
            MockEntityType.USER as unknown as EntityType,
            '',
          );
        expect(filteredCount).toEqual(totalCount); // Empty query matches all
        expect(items.length).toEqual(totalCount);
      });

      it('should handle invalid regex gracefully', async () => {
        // Example of invalid regex pattern
        const { items, totalCount, filteredCount } =
          await entityRepository.queryEntities(
            MockEntityType.USER as unknown as EntityType,
            '+',
          );
        expect(filteredCount).toBeUndefined(); // Expect no matches for invalid regex
        expect(items.length).toBe(0);
        expect(totalCount).toBeGreaterThanOrEqual(0);
      });
    });

    it('should delete an entity', async () => {
      // Create a temporary entity to delete
      const tempUser = await entityRepository.createEntity(
        MockEntityType.USER as unknown as EntityType,
        { name: 'To Delete', email: `delete-${ulid()}@example.com` },
      );
      expect(tempUser.entityId).toBeDefined();

      // Delete it
      await entityRepository.deleteEntity(
        MockEntityType.USER as unknown as EntityType,
        tempUser.entityId!,
      );

      // Verify it's gone
      await expect(
        entityRepository.getEntity(
          MockEntityType.USER as unknown as EntityType,
          tempUser.entityId!,
        ),
      ).rejects.toThrow('Entity item empty');

      // Also try deleting the main test user created at the start of this block
      await entityRepository.deleteEntity(
        MockEntityType.USER as unknown as EntityType,
        createdUser.entityId!,
      );
      await expect(
        entityRepository.getEntity(
          MockEntityType.USER as unknown as EntityType,
          createdUser.entityId!,
        ),
      ).rejects.toThrow('Entity item empty');
      // TODO: after integrate with replicator
      // Verify email GSI record is also gone (implicitly tested by trying to create user with same email again)
      // await expect(
      //   entityRepository.getEmailAvailability(MockEntityType.USER as unknown as EntityType, userEmail),
      // ).resolves.toBeUndefined();
    });

    it('should throw when deleting a non-existent entity', async () => {
      await expect(
        entityRepository.deleteEntity(
          MockEntityType.USER as unknown as EntityType,
          'non-existent-id',
        ),
      ).rejects.toThrow('Entity not found');
    });
  });
});
