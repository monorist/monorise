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
import { z } from 'zod';
import {
  type Entity as EntityType,
  createEntityConfig,
  createMutualConfig,
} from '../../../base';
import { setupCommonRoutes } from '../../controllers/setupRoutes';
import {
  createDynamoDbClient,
  createTestTable,
  deleteTestTable,
  getTableName,
} from '../../helpers/test/test-utils';
import { DependencyContainer } from '../../services/DependencyContainer';

// createMutual / updateMutual / deleteMutual inside POST /transaction,
// against LocalStack.
// The shape is a guardian <-> player link plus a counter on the player that
// must never drop below one guardian: the case a single transaction across
// a mutual and a conditional adjust exists for.
enum TestEntity {
  GUARDIAN = 'guardian',
  PLAYER = 'player',
}

const GUARDIAN = TestEntity.GUARDIAN as unknown as EntityType;
const PLAYER = TestEntity.PLAYER as unknown as EntityType;

const guardianPlayerMutual = createMutualConfig({
  entities: [GUARDIAN, PLAYER],
  mutualDataSchema: z.object({ role: z.enum(['GUARDIAN', 'SELF']) }),
});

const entityConfig = {
  [TestEntity.GUARDIAN]: createEntityConfig({
    name: TestEntity.GUARDIAN,
    displayName: 'Guardian',
    baseSchema: z.object({ name: z.string() }).partial(),
    mutual: {
      mutualSchema: z.object({ playerIds: z.string().array() }).partial(),
      mutualFields: {
        playerIds: { entityType: PLAYER, mutual: guardianPlayerMutual },
      },
    },
  }),
  [TestEntity.PLAYER]: createEntityConfig({
    name: TestEntity.PLAYER,
    displayName: 'Player',
    baseSchema: z
      .object({ name: z.string(), guardianCount: z.number() })
      .partial(),
    adjustmentConditions: {
      join: { guardianCount: { $gte: 1 } },
      leave: { guardianCount: { $gte: 2 } },
    },
    mutual: {
      mutualSchema: z.object({ guardianIds: z.string().array() }).partial(),
      mutualFields: {
        guardianIds: { entityType: GUARDIAN, mutual: guardianPlayerMutual },
      },
    },
  }),
};

const TABLE_NAME = getTableName();
const dynamodbClient = createDynamoDbClient();

const container = new DependencyContainer({
  EntityConfig: entityConfig as unknown as Record<
    EntityType,
    ReturnType<typeof createEntityConfig>
  >,
  AllowedEntityTypes: [GUARDIAN, PLAYER],
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

const { entityRepository, mutualRepository, mutualService } = container;

const post = async (operations: object[]) => {
  const res = await app.request('/transaction', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'account-id': 'acc-1' },
    body: JSON.stringify({ operations }),
  });
  return {
    status: res.status,
    data: (await res.json()) as Record<string, unknown>,
  };
};

const createGuardian = async (name: string) =>
  (await entityRepository.createEntity(GUARDIAN, { name })).entityId as string;

const createPlayer = async (guardianCount: number) =>
  (
    await entityRepository.createEntity(PLAYER, {
      name: 'Alex',
      guardianCount,
    })
  ).entityId as string;

const guardianCountOf = async (playerId: string) =>
  (await entityRepository.getEntity(PLAYER, playerId)).data.guardianCount;

const isLinked = async (guardianId: string, playerId: string) =>
  mutualRepository
    .getMutual(GUARDIAN, guardianId, PLAYER, playerId)
    .then(() => true)
    .catch(() => false);

const link = (guardianId: string, playerId: string) =>
  mutualService.createMutual({
    byEntityType: GUARDIAN,
    byEntityId: guardianId,
    entityType: PLAYER,
    entityId: playerId,
    mutualPayload: { role: 'GUARDIAN' },
  });

const createMutualOp = (
  guardianId: string,
  playerId: string,
  payload: Record<string, unknown> = { role: 'GUARDIAN' },
) => ({
  operation: 'createMutual',
  byEntityType: TestEntity.GUARDIAN,
  byEntityId: guardianId,
  entityType: TestEntity.PLAYER,
  entityId: playerId,
  payload,
});

const updateMutualOp = (
  guardianId: string,
  playerId: string,
  payload: Record<string, unknown>,
) => ({
  operation: 'updateMutual',
  byEntityType: TestEntity.GUARDIAN,
  byEntityId: guardianId,
  entityType: TestEntity.PLAYER,
  entityId: playerId,
  payload,
});

const mutualDataOf = async (guardianId: string, playerId: string) =>
  (await mutualRepository.getMutual(GUARDIAN, guardianId, PLAYER, playerId))
    .mutualData;

const reverseMutualDataOf = async (guardianId: string, playerId: string) =>
  (await mutualRepository.getMutual(PLAYER, playerId, GUARDIAN, guardianId))
    .mutualData;

const deleteMutualOp = (guardianId: string, playerId: string) => ({
  operation: 'deleteMutual',
  byEntityType: TestEntity.GUARDIAN,
  byEntityId: guardianId,
  entityType: TestEntity.PLAYER,
  entityId: playerId,
});

const adjustOp = (playerId: string, delta: number, condition: string) => ({
  operation: 'adjustEntity',
  entityType: TestEntity.PLAYER,
  entityId: playerId,
  adjustments: { guardianCount: delta },
  condition,
});

describe('POST /transaction — createMutual / updateMutual / deleteMutual', () => {
  beforeAll(async () => {
    await createTestTable(TABLE_NAME, dynamodbClient);
  }, 60000);

  afterAll(async () => {
    await deleteTestTable(TABLE_NAME, dynamodbClient);
  }, 60000);

  beforeEach(() => {
    mockPublishEvent.mockClear();
  });

  it('creates a mutual with validated mutual data, readable from both sides', async () => {
    const guardianId = await createGuardian('Sam');
    const playerId = await createPlayer(0);

    const { status, data } = await post([createMutualOp(guardianId, playerId)]);

    expect(status).toBe(200);
    const [entry] = data.results as Record<string, unknown>[];
    expect(entry).toMatchObject({
      operation: 'createMutual',
      byEntityType: TestEntity.GUARDIAN,
      byEntityId: guardianId,
      entityType: TestEntity.PLAYER,
      entityId: playerId,
      mutualData: { role: 'GUARDIAN' },
      data: { name: 'Alex', guardianCount: 0 },
    });
    expect(entry.mutualId).toEqual(expect.any(String));

    const forward = await mutualRepository.getMutual(
      GUARDIAN,
      guardianId,
      PLAYER,
      playerId,
    );
    expect(forward.mutualData).toEqual({ role: 'GUARDIAN' });
    const reverse = await mutualRepository.getMutual(
      PLAYER,
      playerId,
      GUARDIAN,
      guardianId,
    );
    expect(reverse.mutualId).toBe(forward.mutualId);

    const detailTypes = mockPublishEvent.mock.calls.map(
      ([ev]) => ev.event.DetailType,
    );
    expect(detailTypes).toContain(
      `mutual-created:${TestEntity.GUARDIAN}:${TestEntity.PLAYER}`,
    );
  });

  it('commits createMutual and a conditional adjust together', async () => {
    const firstGuardian = await createGuardian('Sam');
    const secondGuardian = await createGuardian('Jo');
    const playerId = await createPlayer(1);
    await link(firstGuardian, playerId);

    const { status } = await post([
      createMutualOp(secondGuardian, playerId),
      adjustOp(playerId, 1, 'join'),
    ]);

    expect(status).toBe(200);
    expect(await isLinked(secondGuardian, playerId)).toBe(true);
    expect(await guardianCountOf(playerId)).toBe(2);
  });

  it('commits deleteMutual and a conditional adjust together', async () => {
    const firstGuardian = await createGuardian('Sam');
    const secondGuardian = await createGuardian('Jo');
    const playerId = await createPlayer(2);
    await link(firstGuardian, playerId);
    await link(secondGuardian, playerId);
    mockPublishEvent.mockClear();

    const { status, data } = await post([
      adjustOp(playerId, -1, 'leave'),
      deleteMutualOp(secondGuardian, playerId),
    ]);

    expect(status).toBe(200);
    expect(await isLinked(secondGuardian, playerId)).toBe(false);
    expect(await isLinked(firstGuardian, playerId)).toBe(true);
    expect(await guardianCountOf(playerId)).toBe(1);

    const deleteEntry = (data.results as Record<string, unknown>[])[1];
    expect(deleteEntry).toMatchObject({
      operation: 'deleteMutual',
      byEntityId: secondGuardian,
      entityId: playerId,
    });
    const detailTypes = mockPublishEvent.mock.calls.map(
      ([ev]) => ev.event.DetailType,
    );
    expect(detailTypes).toContain(
      `mutual-updated:${TestEntity.GUARDIAN}:${TestEntity.PLAYER}`,
    );
  });

  it('rolls the deleteMutual back when the adjust condition fails', async () => {
    const guardianId = await createGuardian('Sam');
    const playerId = await createPlayer(1);
    await link(guardianId, playerId);
    mockPublishEvent.mockClear();

    const { status, data } = await post([
      adjustOp(playerId, -1, 'leave'),
      deleteMutualOp(guardianId, playerId),
    ]);

    expect(status).toBe(409);
    expect(data.code).toBe('TRANSACTION_FAILED');
    expect(await isLinked(guardianId, playerId)).toBe(true);
    expect(await guardianCountOf(playerId)).toBe(1);
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });

  it('returns 404 MUTUAL_NOT_FOUND for deleteMutual on an unlinked pair, writing nothing', async () => {
    const guardianId = await createGuardian('Sam');
    const playerId = await createPlayer(2);

    const { status, data } = await post([
      adjustOp(playerId, -1, 'leave'),
      deleteMutualOp(guardianId, playerId),
    ]);

    expect(status).toBe(404);
    expect(data.code).toBe('MUTUAL_NOT_FOUND');
    expect(await guardianCountOf(playerId)).toBe(2);
  });

  it('returns 409 MUTUAL_EXISTS for createMutual on an already-linked pair', async () => {
    const guardianId = await createGuardian('Sam');
    const playerId = await createPlayer(1);
    await link(guardianId, playerId);

    const { status, data } = await post([createMutualOp(guardianId, playerId)]);

    expect(status).toBe(409);
    expect(data.code).toBe('MUTUAL_EXISTS');
  });

  it('allows re-linking a pair after a transactional deleteMutual', async () => {
    const firstGuardian = await createGuardian('Sam');
    const secondGuardian = await createGuardian('Jo');
    const playerId = await createPlayer(2);
    await link(firstGuardian, playerId);
    await link(secondGuardian, playerId);

    await post([
      adjustOp(playerId, -1, 'leave'),
      deleteMutualOp(secondGuardian, playerId),
    ]);
    const { status } = await post([
      createMutualOp(secondGuardian, playerId),
      adjustOp(playerId, 1, 'join'),
    ]);

    expect(status).toBe(200);
    expect(await isLinked(secondGuardian, playerId)).toBe(true);
    expect(await guardianCountOf(playerId)).toBe(2);
  });

  it('returns 400 when the payload fails the mutualDataSchema', async () => {
    const guardianId = await createGuardian('Sam');
    const playerId = await createPlayer(0);

    const { status, data } = await post([
      createMutualOp(guardianId, playerId, { role: 'COACH' }),
    ]);

    expect(status).toBe(400);
    expect(data.code).toBe('API_VALIDATION_ERROR');
    expect(await isLinked(guardianId, playerId)).toBe(false);
  });

  it('returns 404 when either entity does not exist', async () => {
    const guardianId = await createGuardian('Sam');

    const { status, data } = await post([
      createMutualOp(guardianId, 'missing-player'),
    ]);

    expect(status).toBe(404);
    expect(data.code).toBe('ENTITY_IS_UNDEFINED');
  });

  it('returns 400 for an unknown entity type or a missing id', async () => {
    const unknownType = await post([
      { ...deleteMutualOp('g', 'p'), entityType: 'nonexistent' },
    ]);
    expect(unknownType.status).toBe(400);
    expect(unknownType.data.code).toBe('INVALID_ENTITY_TYPE');

    const missingId = await post([
      { ...deleteMutualOp('g', 'p'), byEntityId: '' },
    ]);
    expect(missingId.status).toBe(400);
    expect(missingId.data.code).toBe('TRANSACTION_INVALID_OPERATION');
  });

  it('commits updateMutual and a conditional adjust together, returning the stored values', async () => {
    const guardianId = await createGuardian('Sam');
    const playerId = await createPlayer(1);
    await link(guardianId, playerId);
    mockPublishEvent.mockClear();

    const { status, data } = await post([
      updateMutualOp(guardianId, playerId, { role: 'SELF' }),
      adjustOp(playerId, 1, 'join'),
    ]);

    expect(status).toBe(200);
    expect(await mutualDataOf(guardianId, playerId)).toEqual({ role: 'SELF' });
    expect(await reverseMutualDataOf(guardianId, playerId)).toEqual({
      role: 'SELF',
    });
    expect(await guardianCountOf(playerId)).toBe(2);

    const [entry] = data.results as Record<string, unknown>[];
    expect(entry).toMatchObject({
      operation: 'updateMutual',
      byEntityType: TestEntity.GUARDIAN,
      byEntityId: guardianId,
      entityType: TestEntity.PLAYER,
      entityId: playerId,
      mutualData: { role: 'SELF' },
      // The same transaction adjusted the player, so the entry carries its
      // committed data, not the copy read before the commit.
      data: { name: 'Alex', guardianCount: 2 },
    });
    expect(entry.mutualId).toEqual(expect.any(String));
    expect(entry.mutualUpdatedAt).toEqual(expect.any(String));

    const updated = mockPublishEvent.mock.calls.find(
      ([ev]) =>
        ev.event.DetailType ===
        `mutual-updated:${TestEntity.GUARDIAN}:${TestEntity.PLAYER}`,
    );
    expect(updated?.[0].payload).toMatchObject({
      byEntityId: guardianId,
      entityId: playerId,
      parsedMutualPayload: { role: 'SELF' },
      updatedByAccountId: 'acc-1',
    });
  });

  it('rolls the updateMutual back when the adjust condition fails', async () => {
    const guardianId = await createGuardian('Sam');
    const playerId = await createPlayer(1);
    await link(guardianId, playerId);
    mockPublishEvent.mockClear();

    const { status, data } = await post([
      updateMutualOp(guardianId, playerId, { role: 'SELF' }),
      adjustOp(playerId, -1, 'leave'),
    ]);

    expect(status).toBe(409);
    expect(data.code).toBe('TRANSACTION_FAILED');
    expect(await mutualDataOf(guardianId, playerId)).toEqual({
      role: 'GUARDIAN',
    });
    expect(await guardianCountOf(playerId)).toBe(1);
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });

  it('returns 404 MUTUAL_NOT_FOUND for updateMutual on an unlinked pair, writing nothing', async () => {
    const guardianId = await createGuardian('Sam');
    const playerId = await createPlayer(1);

    const { status, data } = await post([
      updateMutualOp(guardianId, playerId, { role: 'SELF' }),
      adjustOp(playerId, 1, 'join'),
    ]);

    expect(status).toBe(404);
    expect(data.code).toBe('MUTUAL_NOT_FOUND');
    expect(await guardianCountOf(playerId)).toBe(1);
  });

  it('returns 400 when the updateMutual payload fails the mutualDataSchema', async () => {
    const guardianId = await createGuardian('Sam');
    const playerId = await createPlayer(1);
    await link(guardianId, playerId);

    const { status, data } = await post([
      updateMutualOp(guardianId, playerId, { role: 'COACH' }),
    ]);

    expect(status).toBe(400);
    expect(data.code).toBe('API_VALIDATION_ERROR');
    expect(await mutualDataOf(guardianId, playerId)).toEqual({
      role: 'GUARDIAN',
    });
  });

  it('returns 400 for an updateMutual without a payload', async () => {
    const { status, data } = await post([
      { ...updateMutualOp('g', 'p', {}), payload: undefined },
    ]);

    expect(status).toBe(400);
    expect(data.code).toBe('TRANSACTION_INVALID_OPERATION');
  });

  it('gives a createMutual entry the committed data of a target adjusted in the same transaction', async () => {
    const firstGuardian = await createGuardian('Sam');
    const secondGuardian = await createGuardian('Jo');
    const playerId = await createPlayer(1);
    await link(firstGuardian, playerId);

    // The adjust comes first, so the createMutual read the player before it.
    const { status, data } = await post([
      adjustOp(playerId, 1, 'join'),
      createMutualOp(secondGuardian, playerId),
    ]);

    expect(status).toBe(200);
    const createEntry = (data.results as Record<string, unknown>[])[1];
    expect(createEntry).toMatchObject({
      operation: 'createMutual',
      data: { name: 'Alex', guardianCount: 2 },
    });
  });
});
