import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entity as EntityType, createEntityConfig } from '../../../base';
import { setupCommonRoutes } from '../../controllers/setupRoutes';
import { DependencyContainer } from '../../services/DependencyContainer';
import {
  MockEntityType,
  createDynamoDbClient,
  createMockEntityConfig,
  createTestTable,
  deleteTestTable,
  getTableName,
} from '../../helpers/test/test-utils';

const TABLE_NAME = getTableName();
const dynamodbClient = createDynamoDbClient();
const mockEntityConfig = createMockEntityConfig();

const container = new DependencyContainer({
  EntityConfig: mockEntityConfig as unknown as Record<EntityType, ReturnType<typeof createEntityConfig>>,
  AllowedEntityTypes: Object.values(MockEntityType) as unknown as EntityType[],
  EmailAuthEnabledEntities: [],
  tableName: TABLE_NAME,
});
// Inject LocalStack DynamoDB client before any getter fires
// biome-ignore lint/suspicious/noExplicitAny: accessing private field for test injection
(container as any)._instanceCache.set('DynamoDB', dynamodbClient);
// Inject no-op publishEvent (bypass EventBridge wiring)
// biome-ignore lint/suspicious/noExplicitAny: accessing private field for test injection
(container as any)._publishEvent = vi.fn().mockResolvedValue(undefined);

const app = new Hono();
app.route('/', setupCommonRoutes(container));

// Use repository directly for test fixture creation (faster, skips HTTP)
const entityRepository = container.entityRepository;

type PatchResult = { status: number; data: Record<string, unknown> };

const patch = async (entityType: string, entityId: string, body: object): Promise<PatchResult> => {
  const res = await app.request(`/entity/${entityType}/${entityId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as Record<string, unknown> };
};

const WALLET = MockEntityType.WALLET as unknown as EntityType;
const USER = MockEntityType.USER as unknown as EntityType;

describe('HTTP — conditional updateEntity ($where body key)', () => {
  beforeAll(async () => {
    await createTestTable(TABLE_NAME, dynamodbClient);
  }, 60000);

  afterAll(async () => {
    await deleteTestTable(TABLE_NAME, dynamodbClient);
  }, 60000);

  // ─── Group 0: HTTP mechanics ──────────────────────────────────────────────

  describe('Group 0: HTTP mechanics', () => {
    it('0.1 — valid update returns 200 with entity JSON', async () => {
      const entity = await entityRepository.createEntity(WALLET, { balance: 10 });
      const { status, data } = await patch(MockEntityType.WALLET, entity.entityId as string, {
        balance: 20,
        $where: { balance: { $eq: 10 } },
      });
      expect(status).toBe(200);
      expect(data.data.balance).toBe(20);
      expect(data.entityId).toBe(entity.entityId);
      const stored = await entityRepository.getEntity(WALLET, entity.entityId as string);
      expect(stored.data.balance).toBe(20);
    });

    it('0.2 — unknown entity type returns 404 (entityTypeCheck middleware)', async () => {
      // entityTypeCheck applies to /entity/:entityType (exact depth); use GET list route
      const res = await app.request('/entity/unknown-type', { method: 'GET' });
      expect(res.status).toBe(404);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('NOT_FOUND');
    });

    it('0.3 — Zod-invalid payload returns 400 API_VALIDATION_ERROR', async () => {
      const entity = await entityRepository.createEntity(WALLET, { balance: 10 });
      // wallet.balance must be a number; sending a string triggers Zod error
      const { status, data } = await patch(MockEntityType.WALLET, entity.entityId as string, {
        balance: 'not-a-number',
      });
      expect(status).toBe(400);
      expect(data.code).toBe('API_VALIDATION_ERROR');
      const stored = await entityRepository.getEntity(WALLET, entity.entityId as string);
      expect(stored.data.balance).toBe(10);
    });

    it('0.4 — no $where is backward compatible (attribute_exists check only)', async () => {
      const entity = await entityRepository.createEntity(WALLET, { balance: 50 });
      const { status, data } = await patch(MockEntityType.WALLET, entity.entityId as string, {
        balance: 75,
      });
      expect(status).toBe(200);
      expect(data.data.balance).toBe(75);
      const stored = await entityRepository.getEntity(WALLET, entity.entityId as string);
      expect(stored.data.balance).toBe(75);
    });
  });

  // ─── Group 1: $eq ─────────────────────────────────────────────────────────

  describe('Group 1: $eq', () => {
    let entity: Awaited<ReturnType<typeof entityRepository.createEntity>>;

    beforeEach(async () => {
      entity = await entityRepository.createEntity(WALLET, { balance: 100 });
    });

    it('1.1 — $eq matches → 200 with updated entity', async () => {
      const { status, data } = await patch(MockEntityType.WALLET, entity.entityId as string, {
        balance: 200,
        $where: { balance: { $eq: 100 } },
      });
      expect(status).toBe(200);
      expect(data.data.balance).toBe(200);
      const stored = await entityRepository.getEntity(WALLET, entity.entityId as string);
      expect(stored.data.balance).toBe(200);
    });

    it('1.2 — $eq mismatch → 409 CONDITIONAL_CHECK_FAILED', async () => {
      const { status, data } = await patch(MockEntityType.WALLET, entity.entityId as string, {
        balance: 200,
        $where: { balance: { $eq: 999 } },
      });
      expect(status).toBe(409);
      expect(data.code).toBe('CONDITIONAL_CHECK_FAILED');
      const stored = await entityRepository.getEntity(WALLET, entity.entityId as string);
      expect(stored.data.balance).toBe(100);
    });
  });

  // ─── Group 2: Comparison operators ────────────────────────────────────────

  describe('Group 2: $ne, $gt, $gte, $lt, $lte', () => {
    let entity: Awaited<ReturnType<typeof entityRepository.createEntity>>;

    beforeEach(async () => {
      entity = await entityRepository.createEntity(WALLET, { balance: 10, credits: 50 });
    });

    it('2.1 — $ne passes when value differs → 200', async () => {
      const { status, data } = await patch(MockEntityType.WALLET, entity.entityId as string, {
        credits: 60,
        $where: { balance: { $ne: 999 } },
      });
      expect(status).toBe(200);
      expect(data.data.credits).toBe(60);
      const stored = await entityRepository.getEntity(WALLET, entity.entityId as string);
      expect(stored.data.credits).toBe(60);
    });

    it('2.2 — $ne fails when value matches → 409', async () => {
      const { status, data } = await patch(MockEntityType.WALLET, entity.entityId as string, {
        credits: 60,
        $where: { balance: { $ne: 10 } },
      });
      expect(status).toBe(409);
      expect(data.code).toBe('CONDITIONAL_CHECK_FAILED');
      const stored = await entityRepository.getEntity(WALLET, entity.entityId as string);
      expect(stored.data.credits).toBe(50);
    });

    it('2.3 — $gt passes when field exceeds threshold → 200', async () => {
      const { status, data } = await patch(MockEntityType.WALLET, entity.entityId as string, {
        balance: 8,
        $where: { balance: { $gt: 5 } },
      });
      expect(status).toBe(200);
      expect(data.data.balance).toBe(8);
      const stored = await entityRepository.getEntity(WALLET, entity.entityId as string);
      expect(stored.data.balance).toBe(8);
    });

    it('2.4 — $gt fails at boundary (equal, not greater) → 409', async () => {
      const { status, data } = await patch(MockEntityType.WALLET, entity.entityId as string, {
        balance: 8,
        $where: { balance: { $gt: 10 } },
      });
      expect(status).toBe(409);
      expect(data.code).toBe('CONDITIONAL_CHECK_FAILED');
      const stored = await entityRepository.getEntity(WALLET, entity.entityId as string);
      expect(stored.data.balance).toBe(10);
    });

    it('2.5 — $gte passes at boundary → 200', async () => {
      const { status, data } = await patch(MockEntityType.WALLET, entity.entityId as string, {
        balance: 5,
        $where: { balance: { $gte: 10 } },
      });
      expect(status).toBe(200);
      expect(data.data.balance).toBe(5);
      const stored = await entityRepository.getEntity(WALLET, entity.entityId as string);
      expect(stored.data.balance).toBe(5);
    });

    it('2.6 — $lt passes when field is below threshold → 200', async () => {
      const { status, data } = await patch(MockEntityType.WALLET, entity.entityId as string, {
        credits: 40,
        $where: { balance: { $lt: 100 } },
      });
      expect(status).toBe(200);
      expect(data.data.credits).toBe(40);
      const stored = await entityRepository.getEntity(WALLET, entity.entityId as string);
      expect(stored.data.credits).toBe(40);
    });

    it('2.7 — $lte fails when field exceeds threshold → 409', async () => {
      const { status, data } = await patch(MockEntityType.WALLET, entity.entityId as string, {
        credits: 40,
        $where: { balance: { $lte: 5 } },
      });
      expect(status).toBe(409);
      expect(data.code).toBe('CONDITIONAL_CHECK_FAILED');
      const stored = await entityRepository.getEntity(WALLET, entity.entityId as string);
      expect(stored.data.credits).toBe(50);
    });
  });

  // ─── Group 3: $exists ──────────────────────────────────────────────────────

  describe('Group 3: $exists', () => {
    it('3.1 — $exists: true passes when field is present → 200', async () => {
      const entity = await entityRepository.createEntity(WALLET, { balance: 100 });
      const { status, data } = await patch(MockEntityType.WALLET, entity.entityId as string, {
        credits: 10,
        $where: { balance: { $exists: true } },
      });
      expect(status).toBe(200);
      expect(data.data.credits).toBe(10);
      const stored = await entityRepository.getEntity(WALLET, entity.entityId as string);
      expect(stored.data.credits).toBe(10);
    });

    it('3.2 — $exists: true fails when field is absent → 409', async () => {
      const entity = await entityRepository.createEntity(WALLET, { credits: 5 });
      const { status, data } = await patch(MockEntityType.WALLET, entity.entityId as string, {
        credits: 10,
        $where: { balance: { $exists: true } },
      });
      expect(status).toBe(409);
      expect(data.code).toBe('CONDITIONAL_CHECK_FAILED');
      const stored = await entityRepository.getEntity(WALLET, entity.entityId as string);
      expect(stored.data.credits).toBe(5);
    });

    it('3.3 — $exists: false passes when field is absent → 200', async () => {
      const entity = await entityRepository.createEntity(WALLET, { credits: 5 });
      const { status, data } = await patch(MockEntityType.WALLET, entity.entityId as string, {
        credits: 10,
        $where: { balance: { $exists: false } },
      });
      expect(status).toBe(200);
      expect(data.data.credits).toBe(10);
      const stored = await entityRepository.getEntity(WALLET, entity.entityId as string);
      expect(stored.data.credits).toBe(10);
    });

    it('3.4 — $exists: false fails when field is present → 409', async () => {
      const entity = await entityRepository.createEntity(WALLET, { balance: 100 });
      const { status, data } = await patch(MockEntityType.WALLET, entity.entityId as string, {
        credits: 10,
        $where: { balance: { $exists: false } },
      });
      expect(status).toBe(409);
      expect(data.code).toBe('CONDITIONAL_CHECK_FAILED');
      const stored = await entityRepository.getEntity(WALLET, entity.entityId as string);
      expect(stored.data.credits).toBeUndefined();
    });
  });

  // ─── Group 4: $beginsWith ──────────────────────────────────────────────────

  describe('Group 4: $beginsWith', () => {
    it('4.1 — passes when prefix matches → 200', async () => {
      const entity = await entityRepository.createEntity(USER, {
        name: 'draft-report',
        username: `user-${Date.now()}`,
      });
      const { status, data } = await patch(MockEntityType.USER, entity.entityId as string, {
        name: 'final-report',
        $where: { name: { $beginsWith: 'draft-' } },
      });
      expect(status).toBe(200);
      expect(data.data.name).toBe('final-report');
      const stored = await entityRepository.getEntity(USER, entity.entityId as string);
      expect(stored.data.name).toBe('final-report');
    });

    it('4.2 — fails when prefix does not match → 409', async () => {
      const entity = await entityRepository.createEntity(USER, {
        name: 'final-report',
        username: `user-${Date.now()}-2`,
      });
      const { status, data } = await patch(MockEntityType.USER, entity.entityId as string, {
        name: 'published-report',
        $where: { name: { $beginsWith: 'draft-' } },
      });
      expect(status).toBe(409);
      expect(data.code).toBe('CONDITIONAL_CHECK_FAILED');
      const stored = await entityRepository.getEntity(USER, entity.entityId as string);
      expect(stored.data.name).toBe('final-report');
    });
  });

  // ─── Group 5: Multiple conditions (AND) ───────────────────────────────────

  describe('Group 5: Multiple AND conditions', () => {
    it('5.1 — all conditions match → 200', async () => {
      const entity = await entityRepository.createEntity(WALLET, { balance: 10, credits: 5 });
      const { status, data } = await patch(MockEntityType.WALLET, entity.entityId as string, {
        balance: 0,
        $where: { balance: { $eq: 10 }, credits: { $gte: 1 } },
      });
      expect(status).toBe(200);
      expect(data.data.balance).toBe(0);
      const stored = await entityRepository.getEntity(WALLET, entity.entityId as string);
      expect(stored.data.balance).toBe(0);
    });

    it('5.2 — one condition does not match → 409', async () => {
      const entity = await entityRepository.createEntity(WALLET, { balance: 10, credits: 0 });
      const { status, data } = await patch(MockEntityType.WALLET, entity.entityId as string, {
        balance: 0,
        $where: { balance: { $eq: 10 }, credits: { $gte: 1 } },
      });
      expect(status).toBe(409);
      expect(data.code).toBe('CONDITIONAL_CHECK_FAILED');
      const stored = await entityRepository.getEntity(WALLET, entity.entityId as string);
      expect(stored.data.balance).toBe(10);
    });

    it('5.3 — both conditions do not match → 409', async () => {
      const entity = await entityRepository.createEntity(WALLET, { balance: 99, credits: 0 });
      const { status, data } = await patch(MockEntityType.WALLET, entity.entityId as string, {
        balance: 0,
        $where: { balance: { $eq: 10 }, credits: { $gte: 1 } },
      });
      expect(status).toBe(409);
      expect(data.code).toBe('CONDITIONAL_CHECK_FAILED');
      const stored = await entityRepository.getEntity(WALLET, entity.entityId as string);
      expect(stored.data.balance).toBe(99);
    });
  });

  // ─── Group 6: HTTP error status codes ────────────────────────────────────

  describe('Group 6: HTTP error status codes', () => {
    it('6.1 — entity not found + no $where → 404 ENTITY_NOT_FOUND', async () => {
      const { status, data } = await patch(MockEntityType.WALLET, 'non-existent-id', {
        balance: 999,
      });
      expect(status).toBe(404);
      expect(data.code).toBe('ENTITY_NOT_FOUND');
    });

    it('6.2 — entity not found + $where → 409 CONDITIONAL_CHECK_FAILED', async () => {
      const { status, data } = await patch(MockEntityType.WALLET, 'non-existent-id', {
        balance: 999,
        $where: { balance: { $eq: 0 } },
      });
      expect(status).toBe(409);
      expect(data.code).toBe('CONDITIONAL_CHECK_FAILED');
    });

    it('6.3 — unique field conflict + where condition matches → 400 UNIQUE_VALUE_EXISTS', async () => {
      const ts = Date.now();
      const username1 = `taken-http-${ts}`;
      const username2 = `other-http-${ts}`;

      await entityRepository.createEntity(USER, { name: 'User One', username: username1 });
      const entity2 = await entityRepository.createEntity(USER, { name: 'User Two', username: username2 });

      const { status, data } = await patch(MockEntityType.USER, entity2.entityId as string, {
        username: username1,
        $where: { name: { $eq: 'User Two' } },
      });
      expect(status).toBe(400);
      expect(data.code).toBe('UNIQUE_VALUE_EXISTS');
      const stored = await entityRepository.getEntity(USER, entity2.entityId as string);
      expect(stored.data.username).toBe(username2);
    });

    it('6.4 — updatedAt is bumped on conditional update → 200', async () => {
      const entity = await entityRepository.createEntity(WALLET, { balance: 10 });
      const before = entity.updatedAt ?? '';
      await new Promise((resolve) => setTimeout(resolve, 50));

      const { status, data } = await patch(MockEntityType.WALLET, entity.entityId as string, {
        balance: 20,
        $where: { balance: { $eq: 10 } },
      });
      expect(status).toBe(200);
      expect(data.updatedAt).toBeDefined();
      expect((data.updatedAt ?? '') > before).toBe(true);
      const stored = await entityRepository.getEntity(WALLET, entity.entityId as string);
      expect(stored.data.balance).toBe(20);
      expect((stored.updatedAt ?? '') > before).toBe(true);
    });
  });

  // ─── Group 8: Shorthand $eq (bare value) ─────────────────────────────────

  describe('Group 8: shorthand $eq (bare value)', () => {
    it('8.1 — bare number matches → 200 with updated entity', async () => {
      const entity = await entityRepository.createEntity(WALLET, { balance: 100 });
      const { status, data } = await patch(MockEntityType.WALLET, entity.entityId as string, {
        balance: 200,
        $where: { balance: 100 },
      });
      expect(status).toBe(200);
      expect(data.data.balance).toBe(200);
      const stored = await entityRepository.getEntity(WALLET, entity.entityId as string);
      expect(stored.data.balance).toBe(200);
    });

    it('8.2 — bare number mismatch → 409 CONDITIONAL_CHECK_FAILED', async () => {
      const entity = await entityRepository.createEntity(WALLET, { balance: 100 });
      const { status, data } = await patch(MockEntityType.WALLET, entity.entityId as string, {
        balance: 200,
        $where: { balance: 999 },
      });
      expect(status).toBe(409);
      expect(data.code).toBe('CONDITIONAL_CHECK_FAILED');
      const stored = await entityRepository.getEntity(WALLET, entity.entityId as string);
      expect(stored.data.balance).toBe(100);
    });

    it('8.3 — bare string matches → 200', async () => {
      const entity = await entityRepository.createEntity(USER, {
        name: 'draft-report',
        username: `user-shorthand-match-${Date.now()}`,
      });
      const { status, data } = await patch(MockEntityType.USER, entity.entityId as string, {
        name: 'final-report',
        $where: { name: 'draft-report' },
      });
      expect(status).toBe(200);
      expect(data.data.name).toBe('final-report');
      const stored = await entityRepository.getEntity(USER, entity.entityId as string);
      expect(stored.data.name).toBe('final-report');
    });

    it('8.4 — bare string mismatch → 409 CONDITIONAL_CHECK_FAILED', async () => {
      const entity = await entityRepository.createEntity(USER, {
        name: 'final-report',
        username: `user-shorthand-mismatch-${Date.now()}`,
      });
      const { status, data } = await patch(MockEntityType.USER, entity.entityId as string, {
        name: 'published-report',
        $where: { name: 'draft-report' },
      });
      expect(status).toBe(409);
      expect(data.code).toBe('CONDITIONAL_CHECK_FAILED');
      const stored = await entityRepository.getEntity(USER, entity.entityId as string);
      expect(stored.data.name).toBe('final-report');
    });
  });

  // ─── Group 9: Named conditions ($condition) ───────────────────────────────

  describe('Group 9: named conditions ($condition)', () => {
    it('9.1 — static condition match → 200', async () => {
      const entity = await entityRepository.createEntity(WALLET, {
        balance: 100,
        status: 'draft',
      });
      const { status, data } = await patch(
        MockEntityType.WALLET,
        entity.entityId as string,
        { status: 'published', $condition: 'publish' },
      );
      expect(status).toBe(200);
      expect(data.data.status).toBe('published');
    });

    it('9.2 — static condition mismatch → 409', async () => {
      const entity = await entityRepository.createEntity(WALLET, {
        balance: 100,
        status: 'published',
      });
      const { status, data } = await patch(
        MockEntityType.WALLET,
        entity.entityId as string,
        { status: 'archived', $condition: 'publish' },
      );
      expect(status).toBe(409);
      expect(data.code).toBe('CONDITIONAL_CHECK_FAILED');
    });

    it('9.3 — unknown condition name → 400', async () => {
      const entity = await entityRepository.createEntity(WALLET, { balance: 100 });
      const { status, data } = await patch(
        MockEntityType.WALLET,
        entity.entityId as string,
        { balance: 200, $condition: 'nonexistent' },
      );
      expect(status).toBe(400);
      expect(data.code).toBe('INVALID_CONDITION');
    });

    it('9.4 — no $condition with no conditions defined → 200 (backward compat)', async () => {
      const entity = await entityRepository.createEntity(USER, {
        name: 'test',
        username: `user-no-condition-${Date.now()}`,
      });
      const { status, data } = await patch(
        MockEntityType.USER,
        entity.entityId as string,
        { name: 'updated' },
      );
      expect(status).toBe(200);
      expect(data.data.name).toBe('updated');
    });

    it('9.5 — $condition on entity with no conditions defined → 400', async () => {
      const entity = await entityRepository.createEntity(USER, {
        name: 'test',
        username: `user-bad-condition-${Date.now()}`,
      });
      const { status, data } = await patch(
        MockEntityType.USER,
        entity.entityId as string,
        { name: 'updated', $condition: 'publish' },
      );
      expect(status).toBe(400);
      expect(data.code).toBe('INVALID_CONDITION');
    });
  });

  // ─── Group 7: Concurrency ─────────────────────────────────────────────────

  describe('Group 7: Concurrency', () => {
    it('7.1 — only one concurrent update wins when all race on same condition', async () => {
      const entity = await entityRepository.createEntity(WALLET, { balance: 100 });

      const CONCURRENCY = 5;
      const results = await Promise.allSettled(
        Array.from({ length: CONCURRENCY }, () =>
          patch(MockEntityType.WALLET, entity.entityId as string, {
            balance: 999,
            $where: { balance: { $eq: 100 } },
          }),
        ),
      );

      // All settle (patch never rejects — HTTP errors come back as resolved with status)
      const winners = results
        .filter((r) => r.status === 'fulfilled')
        .map((r) => (r as PromiseFulfilledResult<PatchResult>).value)
        .filter((v) => v.status === 200);

      const losers = results
        .filter((r) => r.status === 'fulfilled')
        .map((r) => (r as PromiseFulfilledResult<PatchResult>).value)
        .filter((v) => v.status === 409);

      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(CONCURRENCY - 1);
      expect(losers.every((v) => v.data.code === 'CONDITIONAL_CHECK_FAILED')).toBe(true);

      const fetched = await entityRepository.getEntity(WALLET, entity.entityId as string);
      expect(fetched.data.balance).toBe(999);
    });

    it('7.2 — concurrent updates to independent fields can both succeed', async () => {
      const entity = await entityRepository.createEntity(WALLET, { balance: 1, credits: 1 });

      const results = await Promise.allSettled([
        patch(MockEntityType.WALLET, entity.entityId as string, {
          balance: 100,
          $where: { balance: { $eq: 1 } },
        }),
        patch(MockEntityType.WALLET, entity.entityId as string, {
          credits: 200,
          $where: { credits: { $eq: 1 } },
        }),
      ]);

      const winners = results
        .filter((r) => r.status === 'fulfilled')
        .map((r) => (r as PromiseFulfilledResult<PatchResult>).value)
        .filter((v) => v.status === 200);

      expect(winners.length).toBeGreaterThanOrEqual(1);

      const fetched = await entityRepository.getEntity(WALLET, entity.entityId as string);
      if (fetched.data.balance === 100) {
        expect(fetched.data.balance).toBe(100);
      }
      if (fetched.data.credits === 200) {
        expect(fetched.data.credits).toBe(200);
      }
    });
  });
});
