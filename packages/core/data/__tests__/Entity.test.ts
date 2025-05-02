import { ulid } from 'ulid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Entity as EntityType } from '../../../base';
import {
  MockEntityType,
  createTestTable,
  createDynamoDbClient,
  createMockEntityConfig,
  deleteTestTable,
  getTableName,
} from '../../helpers/test/test-utils';
import { Entity, EntityRepository } from '../Entity';

// Initialize constants and clients
const TABLE_NAME = getTableName();
const dynamodbClient = createDynamoDbClient();
const mockEntityConfig = createMockEntityConfig();
const EmailAuthEnabledEntities: EntityType[] = [
  MockEntityType.USER as unknown as EntityType,
];

// Create repository instance
const entityRepository = new EntityRepository(
  mockEntityConfig,
  TABLE_NAME,
  dynamodbClient,
  EmailAuthEnabledEntities,
);

describe('Entity & EntityRepository', () => {
  beforeAll(async () => {
    await createTestTable(TABLE_NAME, dynamodbClient);
  }, 60000); // Increase timeout for table creation

  afterAll(async () => {
    await deleteTestTable(TABLE_NAME, dynamodbClient);
  }, 60000); // Increase timeout for table deletion

  describe('Entity Class', () => {
    it('should correctly initialize and generate keys', () => {
      const userId = ulid();
      const userData = { name: 'Test User', email: 'test@example.com' };
      const entity = new Entity(
        MockEntityType.USER as unknown as EntityType,
        userId,
        userData,
      );

      expect(entity.entityType).toBe(MockEntityType.USER);
      expect(entity.entityId).toBe(userId);
      expect(entity.data).toEqual(userData);
      expect(entity.pk).toBe(`${MockEntityType.USER}#${userId}`);
      expect(entity.sk).toBe('#METADATA#');
      expect(entity.listActionKey).toBe(`LIST#${MockEntityType.USER}`);
      expect(entity.fullId).toBe(`${MockEntityType.USER}#${userId}`);
      expect(entity.emailKeys).toEqual({
        PK: { S: `EMAIL#${userData.email}` },
        SK: { S: `${MockEntityType.USER}#${userId}` },
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
      const entity = new Entity(
        MockEntityType.USER as unknown as EntityType,
        userId,
        userData,
        now,
        now,
      );

      const item = entity.toItem();
      // Basic checks - marshalling adds type info (S, N, etc.)
      expect(item.PK).toEqual({ S: `${MockEntityType.USER}#${userId}` });
      expect(item.SK).toEqual({ S: '#METADATA#' });
      expect(item.entityType).toEqual({ S: MockEntityType.USER });
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

      const reconstructedEntity = Entity.fromItem(item);
      expect(reconstructedEntity.entityType).toBe(MockEntityType.USER);
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
      const entity = new Entity(
        MockEntityType.USER as unknown as EntityType,
        userId,
        userData,
      ); // No dates provided

      const item = entity.toItem();
      expect(item.createdAt).toBeUndefined();
      expect(item.updatedAt).toBeUndefined();

      const reconstructedEntity = Entity.fromItem(item);
      expect(reconstructedEntity.createdAt).toBeUndefined();
      expect(reconstructedEntity.updatedAt).toBeUndefined();
    });

    it('should throw error if item is undefined in fromItem', () => {
      expect(() => Entity.fromItem(undefined)).toThrow('Entity item empty');
    });
  });

  describe('EntityRepository', () => {
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
      createdUser = await entityRepository.createEntity(
        MockEntityType.USER as unknown as EntityType,
        userData,
        undefined,
      );

      expect(createdUser).toBeInstanceOf(Entity);
      expect(createdUser.entityType).toBe(MockEntityType.USER);
      expect(createdUser.entityId).toBeDefined();
      expect(createdUser.data).toEqual(userData);
      expect(createdUser.createdAt).toBeDefined();
      expect(createdUser.updatedAt).toBeDefined();
      expect(createdUser.createdAt).toEqual(createdUser.updatedAt); // Should be same on creation

      // Verify directly in DynamoDB (optional but good practice)
      const fetched = await entityRepository.getEntity(
        MockEntityType.USER as unknown as EntityType,
        createdUser.entityId as unknown as string,
      );
      expect(fetched.entityId).toEqual(createdUser.entityId);
      expect(fetched.data).toEqual(userData);
    });

    it('should fail to create an entity with the same ID', async () => {
      await expect(
        entityRepository.createEntity(
          MockEntityType.USER as unknown as EntityType,
          { name: 'Duplicate', email: 'dup@example.com' },
          createdUser.entityId as unknown as string,
        ),
      ).rejects.toThrow(); // Should throw due to ConditionExpression failure
    });

    it('should fail to create an entity with existing unique field value', async () => {
      await expect(
        entityRepository.createEntity(
          MockEntityType.USER as unknown as EntityType,
          { name: 'Duplicate', username: createdUser.data.username },
          createdUser.entityId as unknown as string,
        ),
      ).rejects.toThrow(); // Should throw due to ConditionExpression failure
    });

    it('should fail to create an entity when unique field value is not string', async () => {
      await expect(
        entityRepository.createEntity(
          MockEntityType.USER as unknown as EntityType,
          { name: 'Invalid record', username: ['123', '456'] },
          createdUser.entityId as unknown as string,
        ),
      ).rejects.toThrow(); // Should throw due to ConditionExpression failure
    });

    it('should get an entity by ID', async () => {
      const fetched = await entityRepository.getEntity(
        MockEntityType.USER as unknown as EntityType,
        createdUser.entityId as unknown as string,
      );
      expect(fetched.entityId).toEqual(createdUser.entityId);
      expect(fetched.data).toEqual(userData);
      expect(fetched.createdAt).toEqual(createdUser.createdAt);
    });

    it('should throw when getting a non-existent entity by ID', async () => {
      await expect(
        entityRepository.getEntity(
          MockEntityType.USER as unknown as EntityType,
          'non-existent-id',
        ),
      ).rejects.toThrow('Entity item empty');
    });

    it('should get an entity by email', async () => {
      const fetched = await entityRepository.getEntityByEmail(
        MockEntityType.USER as unknown as EntityType,
        userEmail,
      );
      expect(fetched.entityId).toEqual(createdUser.entityId);
      expect(fetched.data).toEqual(userData);
    });

    it('should throw when getting a non-existent entity by email', async () => {
      await expect(
        entityRepository.getEntityByEmail(
          MockEntityType.USER as unknown as EntityType,
          'nobody@example.com',
        ),
      ).rejects.toThrow('Entity item empty');
    });

    it('should confirm email availability for an unused email', async () => {
      await expect(
        entityRepository.getEmailAvailability(
          MockEntityType.USER as unknown as EntityType,
          'available@example.com',
        ),
      ).resolves.toBeUndefined();
    });

    it('should throw when checking email availability for a used email', async () => {
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
      const fetched = await entityRepository.getEntity(
        MockEntityType.USER as unknown as EntityType,
        createdUser.entityId as string,
      );
      expect(fetched.data.name).toEqual(updatedName);
      expect(fetched.updatedAt).toEqual(updatedEntity.updatedAt);
    });

    // Additional tests omitted for brevity
    // ... (remaining tests for EntityRepository)

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
          productIds.push(product.entityId as string);
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
        expect(items.length).toBe(7);
        expect(totalCount).toBe(7);
        expect(items[0].entityType).toBe(MockEntityType.PRODUCT);
      });

      // Additional list tests omitted for brevity
      // ... (remaining list tests)
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
      let user1: Entity<EntityType>;
      let user2: Entity<EntityType>;
      let user3: Entity<EntityType>;

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
          user1.entityId as string,
        );
        await entityRepository.deleteEntity(
          MockEntityType.USER as unknown as EntityType,
          user2.entityId as string,
        );
        await entityRepository.deleteEntity(
          MockEntityType.USER as unknown as EntityType,
          user3.entityId as string,
        );
      });

      it('should find entities matching a name fragment (case-insensitive)', async () => {
        const { items, totalCount, filteredCount } =
          await entityRepository.queryEntities(
            MockEntityType.USER as unknown as EntityType,
            'smith',
          );
        expect(totalCount).toBeGreaterThanOrEqual(3);
        expect(filteredCount).toBe(2);
        expect(items.length).toBe(2);
        const names = items.map((i) => i.data.name);
        expect(names).toContain('Alice Smith');
        expect(names).toContain('Charlie Smith');
      });

      // Additional query tests omitted for brevity
      // ... (remaining query tests)
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
        tempUser.entityId as string,
      );

      // Verify it's gone
      await expect(
        entityRepository.getEntity(
          MockEntityType.USER as unknown as EntityType,
          tempUser.entityId as string,
        ),
      ).rejects.toThrow('Entity item empty');

      // Also try deleting the main test user created at the start of this block
      await entityRepository.deleteEntity(
        MockEntityType.USER as unknown as EntityType,
        createdUser.entityId as unknown as string,
      );
      await expect(
        entityRepository.getEntity(
          MockEntityType.USER as unknown as EntityType,
          createdUser.entityId as unknown as string,
        ),
      ).rejects.toThrow('Entity item empty');
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
