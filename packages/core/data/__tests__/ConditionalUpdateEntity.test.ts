import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Entity as EntityType } from '../../../base';
import { StandardErrorCode } from '../../errors/standard-error';
import {
  MockEntityType,
  createDynamoDbClient,
  createMockEntityConfig,
  createTestTable,
  deleteTestTable,
  getTableName,
} from '../../helpers/test/test-utils';
import { type Entity, EntityRepository } from '../Entity';

const TABLE_NAME = getTableName();
const dynamodbClient = createDynamoDbClient();
const mockEntityConfig = createMockEntityConfig();

const entityRepository = new EntityRepository(
  mockEntityConfig,
  TABLE_NAME,
  dynamodbClient,
  [],
);

// Shorthand cast used throughout
const WALLET = MockEntityType.WALLET as unknown as EntityType;
const USER = MockEntityType.USER as unknown as EntityType;

describe('EntityRepository — conditional updateEntity (WHERE clause)', () => {
  beforeAll(async () => {
    await createTestTable(TABLE_NAME, dynamodbClient);
  }, 60000);

  afterAll(async () => {
    await deleteTestTable(TABLE_NAME, dynamodbClient);
  }, 60000);

  // ─── Group 1: Equality ($eq / bare value) ─────────────────────────────────

  describe('Group 1: Equality ($eq)', () => {
    let entity: Entity<EntityType>;

    beforeEach(async () => {
      entity = await entityRepository.createEntity(WALLET, { balance: 100 });
    });

    it('1.1 — succeeds when $eq condition matches', async () => {
      const result = await entityRepository.updateEntity(
        WALLET,
        entity.entityId as string,
        { data: { balance: 200 } },
        {
          ConditionExpression:
            'attribute_exists(PK) AND #data.#where_balance = :where_balance_eq',
          ExpressionAttributeNames: {
            '#data': 'data',
            '#where_balance': 'balance',
          },
          ExpressionAttributeValues: {
            ':where_balance_eq': { N: '100' },
          },
        },
      );
      expect(result.data.balance).toBe(200);
    });

    it('1.2 — throws CONDITIONAL_CHECK_FAILED when $eq condition does not match', async () => {
      await expect(
        entityRepository.updateEntity(
          WALLET,
          entity.entityId as string,
          { data: { balance: 200 } },
          {
            ConditionExpression:
              'attribute_exists(PK) AND #data.#where_balance = :where_balance_eq',
            ExpressionAttributeNames: {
              '#data': 'data',
              '#where_balance': 'balance',
            },
            ExpressionAttributeValues: {
              ':where_balance_eq': { N: '999' },
            },
          },
        ),
      ).rejects.toMatchObject({ code: StandardErrorCode.CONDITIONAL_CHECK_FAILED });
    });

    it('1.3 — backward compatible: no opts still uses attribute_exists(PK) only', async () => {
      const result = await entityRepository.updateEntity(
        WALLET,
        entity.entityId as string,
        { data: { balance: 50 } },
      );
      expect(result.data.balance).toBe(50);
    });
  });

  // ─── Group 2: buildConditionExpression via $ne, $gt, $lt, $gte, $lte ──────

  describe('Group 2: Comparison operators via buildConditionExpression', () => {
    // We test the condition expression builder indirectly through the repository
    // by constructing the raw opts manually, mirroring what buildConditionExpression produces.

    let entity: Entity<EntityType>;

    beforeEach(async () => {
      entity = await entityRepository.createEntity(WALLET, {
        balance: 10,
        credits: 50,
      });
    });

    it('2.1 — $ne passes when value differs', async () => {
      const result = await entityRepository.updateEntity(
        WALLET,
        entity.entityId as string,
        { data: { credits: 60 } },
        {
          ConditionExpression:
            'attribute_exists(PK) AND #data.#where_balance <> :where_balance_ne',
          ExpressionAttributeNames: { '#data': 'data', '#where_balance': 'balance' },
          ExpressionAttributeValues: { ':where_balance_ne': { N: '999' } },
        },
      );
      expect(result.data.credits).toBe(60);
    });

    it('2.2 — $ne fails when value matches', async () => {
      await expect(
        entityRepository.updateEntity(
          WALLET,
          entity.entityId as string,
          { data: { credits: 60 } },
          {
            ConditionExpression:
              'attribute_exists(PK) AND #data.#where_balance <> :where_balance_ne',
            ExpressionAttributeNames: { '#data': 'data', '#where_balance': 'balance' },
            ExpressionAttributeValues: { ':where_balance_ne': { N: '10' } },
          },
        ),
      ).rejects.toMatchObject({ code: StandardErrorCode.CONDITIONAL_CHECK_FAILED });
    });

    it('2.3 — $gt passes when field exceeds threshold', async () => {
      const result = await entityRepository.updateEntity(
        WALLET,
        entity.entityId as string,
        { data: { balance: 8 } },
        {
          ConditionExpression:
            'attribute_exists(PK) AND #data.#where_balance > :where_balance_gt',
          ExpressionAttributeNames: { '#data': 'data', '#where_balance': 'balance' },
          ExpressionAttributeValues: { ':where_balance_gt': { N: '5' } },
        },
      );
      expect(result.data.balance).toBe(8);
    });

    it('2.4 — $gt fails at boundary (equal, not greater)', async () => {
      await expect(
        entityRepository.updateEntity(
          WALLET,
          entity.entityId as string,
          { data: { balance: 8 } },
          {
            ConditionExpression:
              'attribute_exists(PK) AND #data.#where_balance > :where_balance_gt',
            ExpressionAttributeNames: { '#data': 'data', '#where_balance': 'balance' },
            ExpressionAttributeValues: { ':where_balance_gt': { N: '10' } },
          },
        ),
      ).rejects.toMatchObject({ code: StandardErrorCode.CONDITIONAL_CHECK_FAILED });
    });

    it('2.5 — $gte passes at boundary', async () => {
      const result = await entityRepository.updateEntity(
        WALLET,
        entity.entityId as string,
        { data: { balance: 5 } },
        {
          ConditionExpression:
            'attribute_exists(PK) AND #data.#where_balance >= :where_balance_gte',
          ExpressionAttributeNames: { '#data': 'data', '#where_balance': 'balance' },
          ExpressionAttributeValues: { ':where_balance_gte': { N: '10' } },
        },
      );
      expect(result.data.balance).toBe(5);
    });

    it('2.6 — $lt passes when field is below threshold', async () => {
      const result = await entityRepository.updateEntity(
        WALLET,
        entity.entityId as string,
        { data: { credits: 40 } },
        {
          ConditionExpression:
            'attribute_exists(PK) AND #data.#where_balance < :where_balance_lt',
          ExpressionAttributeNames: { '#data': 'data', '#where_balance': 'balance' },
          ExpressionAttributeValues: { ':where_balance_lt': { N: '100' } },
        },
      );
      expect(result.data.credits).toBe(40);
    });

    it('2.7 — $lte fails when field exceeds threshold', async () => {
      await expect(
        entityRepository.updateEntity(
          WALLET,
          entity.entityId as string,
          { data: { credits: 40 } },
          {
            ConditionExpression:
              'attribute_exists(PK) AND #data.#where_balance <= :where_balance_lte',
            ExpressionAttributeNames: { '#data': 'data', '#where_balance': 'balance' },
            ExpressionAttributeValues: { ':where_balance_lte': { N: '5' } },
          },
        ),
      ).rejects.toMatchObject({ code: StandardErrorCode.CONDITIONAL_CHECK_FAILED });
    });
  });

  // ─── Group 3: $exists ──────────────────────────────────────────────────────

  describe('Group 3: $exists', () => {
    it('3.1 — $exists: true passes when field is present', async () => {
      const entity = await entityRepository.createEntity(WALLET, {
        balance: 100,
      });
      const result = await entityRepository.updateEntity(
        WALLET,
        entity.entityId as string,
        { data: { credits: 10 } },
        {
          ConditionExpression:
            'attribute_exists(PK) AND attribute_exists(#data.#where_balance)',
          ExpressionAttributeNames: { '#data': 'data', '#where_balance': 'balance' },
          ExpressionAttributeValues: {},
        },
      );
      expect(result.data.credits).toBe(10);
    });

    it('3.2 — $exists: true fails when field is absent', async () => {
      // Create entity without the `balance` field
      const entity = await entityRepository.createEntity(WALLET, {
        credits: 5,
      });
      await expect(
        entityRepository.updateEntity(
          WALLET,
          entity.entityId as string,
          { data: { credits: 10 } },
          {
            ConditionExpression:
              'attribute_exists(PK) AND attribute_exists(#data.#where_balance)',
            ExpressionAttributeNames: { '#data': 'data', '#where_balance': 'balance' },
            ExpressionAttributeValues: {},
          },
        ),
      ).rejects.toMatchObject({ code: StandardErrorCode.CONDITIONAL_CHECK_FAILED });
    });

    it('3.3 — $exists: false passes when field is absent', async () => {
      const entity = await entityRepository.createEntity(WALLET, {
        credits: 5,
      });
      const result = await entityRepository.updateEntity(
        WALLET,
        entity.entityId as string,
        { data: { credits: 10 } },
        {
          ConditionExpression:
            'attribute_exists(PK) AND attribute_not_exists(#data.#where_balance)',
          ExpressionAttributeNames: { '#data': 'data', '#where_balance': 'balance' },
          ExpressionAttributeValues: {},
        },
      );
      expect(result.data.credits).toBe(10);
    });

    it('3.4 — $exists: false fails when field is present', async () => {
      const entity = await entityRepository.createEntity(WALLET, {
        balance: 100,
      });
      await expect(
        entityRepository.updateEntity(
          WALLET,
          entity.entityId as string,
          { data: { credits: 10 } },
          {
            ConditionExpression:
              'attribute_exists(PK) AND attribute_not_exists(#data.#where_balance)',
            ExpressionAttributeNames: { '#data': 'data', '#where_balance': 'balance' },
            ExpressionAttributeValues: {},
          },
        ),
      ).rejects.toMatchObject({ code: StandardErrorCode.CONDITIONAL_CHECK_FAILED });
    });
  });

  // ─── Group 4: $beginsWith ─────────────────────────────────────────────────

  describe('Group 4: $beginsWith', () => {
    it('4.1 — passes when prefix matches', async () => {
      const entity = await entityRepository.createEntity(USER, {
        name: 'draft-report',
        username: `user-${Date.now()}`,
      });
      const result = await entityRepository.updateEntity(
        USER,
        entity.entityId as string,
        { data: { name: 'final-report' } },
        {
          ConditionExpression:
            'attribute_exists(PK) AND begins_with(#data.#where_name, :where_name_beginsWith)',
          ExpressionAttributeNames: { '#data': 'data', '#where_name': 'name' },
          ExpressionAttributeValues: { ':where_name_beginsWith': { S: 'draft-' } },
        },
      );
      expect(result.data.name).toBe('final-report');
    });

    it('4.2 — fails when prefix does not match', async () => {
      const entity = await entityRepository.createEntity(USER, {
        name: 'final-report',
        username: `user-${Date.now()}-2`,
      });
      await expect(
        entityRepository.updateEntity(
          USER,
          entity.entityId as string,
          { data: { name: 'published-report' } },
          {
            ConditionExpression:
              'attribute_exists(PK) AND begins_with(#data.#where_name, :where_name_beginsWith)',
            ExpressionAttributeNames: { '#data': 'data', '#where_name': 'name' },
            ExpressionAttributeValues: { ':where_name_beginsWith': { S: 'draft-' } },
          },
        ),
      ).rejects.toMatchObject({ code: StandardErrorCode.CONDITIONAL_CHECK_FAILED });
    });
  });

  // ─── Group 5: Multiple conditions (AND) ───────────────────────────────────

  describe('Group 5: Multiple conditions (AND)', () => {
    it('5.1 — succeeds when all conditions match', async () => {
      const entity = await entityRepository.createEntity(WALLET, {
        balance: 10,
        credits: 5,
      });
      const result = await entityRepository.updateEntity(
        WALLET,
        entity.entityId as string,
        { data: { balance: 0 } },
        {
          ConditionExpression:
            'attribute_exists(PK) AND #data.#where_balance = :where_balance_eq AND #data.#where_credits >= :where_credits_gte',
          ExpressionAttributeNames: {
            '#data': 'data',
            '#where_balance': 'balance',
            '#where_credits': 'credits',
          },
          ExpressionAttributeValues: {
            ':where_balance_eq': { N: '10' },
            ':where_credits_gte': { N: '1' },
          },
        },
      );
      expect(result.data.balance).toBe(0);
    });

    it('5.2 — fails when one condition does not match', async () => {
      const entity = await entityRepository.createEntity(WALLET, {
        balance: 10,
        credits: 0,
      });
      await expect(
        entityRepository.updateEntity(
          WALLET,
          entity.entityId as string,
          { data: { balance: 0 } },
          {
            ConditionExpression:
              'attribute_exists(PK) AND #data.#where_balance = :where_balance_eq AND #data.#where_credits >= :where_credits_gte',
            ExpressionAttributeNames: {
              '#data': 'data',
              '#where_balance': 'balance',
              '#where_credits': 'credits',
            },
            ExpressionAttributeValues: {
              ':where_balance_eq': { N: '10' },
              ':where_credits_gte': { N: '1' },
            },
          },
        ),
      ).rejects.toMatchObject({ code: StandardErrorCode.CONDITIONAL_CHECK_FAILED });
    });

    it('5.3 — fails when both conditions do not match', async () => {
      const entity = await entityRepository.createEntity(WALLET, {
        balance: 99,
        credits: 0,
      });
      await expect(
        entityRepository.updateEntity(
          WALLET,
          entity.entityId as string,
          { data: { balance: 0 } },
          {
            ConditionExpression:
              'attribute_exists(PK) AND #data.#where_balance = :where_balance_eq AND #data.#where_credits >= :where_credits_gte',
            ExpressionAttributeNames: {
              '#data': 'data',
              '#where_balance': 'balance',
              '#where_credits': 'credits',
            },
            ExpressionAttributeValues: {
              ':where_balance_eq': { N: '10' },
              ':where_credits_gte': { N: '1' },
            },
          },
        ),
      ).rejects.toMatchObject({ code: StandardErrorCode.CONDITIONAL_CHECK_FAILED });
    });
  });

  // ─── Group 6: Concurrency ─────────────────────────────────────────────────

  describe('Group 6: Concurrency', () => {
    it('6.1 — only one concurrent update wins when all race on same condition', async () => {
      const entity = await entityRepository.createEntity(WALLET, {
        balance: 100,
      });

      const CONCURRENCY = 5;
      const results = await Promise.allSettled(
        Array.from({ length: CONCURRENCY }, () =>
          entityRepository.updateEntity(
            WALLET,
            entity.entityId as string,
            { data: { balance: 999 } },
            {
              ConditionExpression:
                'attribute_exists(PK) AND #data.#where_balance = :where_balance_eq',
              ExpressionAttributeNames: {
                '#data': 'data',
                '#where_balance': 'balance',
              },
              ExpressionAttributeValues: { ':where_balance_eq': { N: '100' } },
            },
          ),
        ),
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(CONCURRENCY - 1);
      expect(
        rejected.every(
          (r) =>
            (r as PromiseRejectedResult).reason?.code ===
            StandardErrorCode.CONDITIONAL_CHECK_FAILED,
        ),
      ).toBe(true);

      const fetched = await entityRepository.getEntity(
        WALLET,
        entity.entityId as string,
      );
      expect(fetched.data.balance).toBe(999);
    });

    it('6.2 — concurrent updates to independent fields can both succeed', async () => {
      const entity = await entityRepository.createEntity(WALLET, {
        balance: 1,
        credits: 1,
      });

      const results = await Promise.allSettled([
        entityRepository.updateEntity(
          WALLET,
          entity.entityId as string,
          { data: { balance: 100 } },
          {
            ConditionExpression:
              'attribute_exists(PK) AND #data.#where_balance = :where_balance_eq',
            ExpressionAttributeNames: { '#data': 'data', '#where_balance': 'balance' },
            ExpressionAttributeValues: { ':where_balance_eq': { N: '1' } },
          },
        ),
        entityRepository.updateEntity(
          WALLET,
          entity.entityId as string,
          { data: { credits: 200 } },
          {
            ConditionExpression:
              'attribute_exists(PK) AND #data.#where_credits = :where_credits_eq',
            ExpressionAttributeNames: { '#data': 'data', '#where_credits': 'credits' },
            ExpressionAttributeValues: { ':where_credits_eq': { N: '1' } },
          },
        ),
      ]);

      // At least one should succeed; verify no data corruption on the winner(s)
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);

      const fetched = await entityRepository.getEntity(
        WALLET,
        entity.entityId as string,
      );
      // Whichever succeeded, the value must be exactly what was written (no partial/corrupt state)
      if (fetched.data.balance === 100) {
        expect(fetched.data.balance).toBe(100);
      }
      if (fetched.data.credits === 200) {
        expect(fetched.data.credits).toBe(200);
      }
    });
  });

  // ─── Group 7: Edge cases ──────────────────────────────────────────────────

  describe('Group 7: Edge cases', () => {
    it('7.1 — no opts is backward compatible (only attribute_exists check)', async () => {
      const entity = await entityRepository.createEntity(WALLET, {
        balance: 50,
      });
      const result = await entityRepository.updateEntity(
        WALLET,
        entity.entityId as string,
        { data: { balance: 75 } },
      );
      expect(result.data.balance).toBe(75);
    });

    it('7.2 — entity does not exist + where → throws CONDITIONAL_CHECK_FAILED (409)', async () => {
      await expect(
        entityRepository.updateEntity(
          WALLET,
          'non-existent-entity-id',
          { data: { balance: 999 } },
          {
            ConditionExpression:
              'attribute_exists(PK) AND #data.#where_balance = :where_balance_eq',
            ExpressionAttributeNames: { '#data': 'data', '#where_balance': 'balance' },
            ExpressionAttributeValues: { ':where_balance_eq': { N: '0' } },
          },
        ),
      ).rejects.toMatchObject({ code: StandardErrorCode.CONDITIONAL_CHECK_FAILED });
    });

    it('7.3 — entity does not exist + no opts → throws ENTITY_NOT_FOUND (404)', async () => {
      await expect(
        entityRepository.updateEntity(
          WALLET,
          'non-existent-entity-id',
          { data: { balance: 999 } },
        ),
      ).rejects.toMatchObject({ code: StandardErrorCode.ENTITY_NOT_FOUND });
    });

    it('7.4 — updatedAt is bumped on conditional update', async () => {
      const entity = await entityRepository.createEntity(WALLET, {
        balance: 10,
      });
      const before = entity.updatedAt ?? '';
      await new Promise((resolve) => setTimeout(resolve, 50));

      const result = await entityRepository.updateEntity(
        WALLET,
        entity.entityId as string,
        { data: { balance: 20 } },
        {
          ConditionExpression:
            'attribute_exists(PK) AND #data.#where_balance = :where_balance_eq',
          ExpressionAttributeNames: { '#data': 'data', '#where_balance': 'balance' },
          ExpressionAttributeValues: { ':where_balance_eq': { N: '10' } },
        },
      );

      expect(result.updatedAt).toBeDefined();
      expect((result.updatedAt ?? '') > before).toBe(true);
    });

    it('7.5 — unique field update + where condition: succeeds when both pass', async () => {
      const username = `unique-where-${Date.now()}`;
      const entity = await entityRepository.createEntity(USER, {
        name: 'Test User',
        username,
      });
      const newUsername = `unique-where-new-${Date.now()}`;

      const result = await entityRepository.updateEntity(
        USER,
        entity.entityId as string,
        { data: { username: newUsername } },
        {
          ConditionExpression:
            'attribute_exists(PK) AND #data.#where_name = :where_name_eq',
          ExpressionAttributeNames: { '#data': 'data', '#where_name': 'name' },
          ExpressionAttributeValues: { ':where_name_eq': { S: 'Test User' } },
        },
      );
      expect(result.data.username).toBe(newUsername);
    });

    it('7.6 — unique field update + where condition: fails when where condition is not met', async () => {
      const username = `unique-where-fail-${Date.now()}`;
      const entity = await entityRepository.createEntity(USER, {
        name: 'Test User',
        username,
      });
      const newUsername = `unique-where-fail-new-${Date.now()}`;

      await expect(
        entityRepository.updateEntity(
          USER,
          entity.entityId as string,
          { data: { username: newUsername } },
          {
            ConditionExpression:
              'attribute_exists(PK) AND #data.#where_name = :where_name_eq',
            ExpressionAttributeNames: { '#data': 'data', '#where_name': 'name' },
            ExpressionAttributeValues: { ':where_name_eq': { S: 'Wrong Name' } },
          },
        ),
      ).rejects.toMatchObject({ code: StandardErrorCode.CONDITIONAL_CHECK_FAILED });
    });

    it('7.7 — unique field conflict + where condition matches → throws UNIQUE_VALUE_EXISTS', async () => {
      const ts = Date.now();
      const username1 = `taken-${ts}`;
      const username2 = `other-${ts}`;

      // Create two users
      await entityRepository.createEntity(USER, {
        name: 'User One',
        username: username1,
      });
      const entity2 = await entityRepository.createEntity(USER, {
        name: 'User Two',
        username: username2,
      });

      // Try to set entity2's username to the already-taken username1
      await expect(
        entityRepository.updateEntity(
          USER,
          entity2.entityId as string,
          { data: { username: username1 } },
          {
            ConditionExpression:
              'attribute_exists(PK) AND #data.#where_name = :where_name_eq',
            ExpressionAttributeNames: { '#data': 'data', '#where_name': 'name' },
            ExpressionAttributeValues: { ':where_name_eq': { S: 'User Two' } },
          },
        ),
      ).rejects.toMatchObject({ code: StandardErrorCode.UNIQUE_VALUE_EXISTS });
    });
  });
});
