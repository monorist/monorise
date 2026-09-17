import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError, z } from 'zod';
import { createEntityConfig } from '../../../base';
import type { Entity as EntityType } from '../../../base';
import { EVENT } from '../../types/event';
import { EntityService } from '../entity.service';
import { TransactionService } from '../transaction.service';

/**
 * Regression coverage for: an `updateEntity` carrying a PARTIAL payload was
 * rejected with a 400 `Required` error for every field on the entity's
 * `mutualSchema` that the update wasn't touching.
 *
 * The configs below mirror the real shape that surfaced it — a PARENT whose
 * `mutualSchema` is deliberately NOT `.partial()` because those relationships
 * genuinely are mandatory at creation time (fixture draw), paired with live
 * updates that only ever move the state/score.
 */
enum TestEntity {
  PARENT = 'parent',
  CHILD_EVENT = 'child-event',
  OWNER = 'owner',
  REGION = 'region',
  SEASON = 'season',
  MEMBER = 'team',
}

const parentClockSchema = z.object({
  period: z.string(),
  time: z.string(),
  status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'PAUSED', 'ENDED']),
  isPaused: z.boolean(),
});

const parentBaseSchema = z
  .object({
    status: z.enum(['UPCOMING', 'IN_PROGRESS', 'FINAL']),
    state: parentClockSchema,
    tallyA: z.number(),
    tallyB: z.number(),
  })
  .partial();

// Non-`.partial()` on purpose — this is the exact authoring choice that broke.
// ownerIds/regionIds/catalogIds/members are all known and required at
// fixture-draw creation time, so the app has every reason to declare them this
// way; it must not make unrelated updates impossible.
const parentMutualSchema = z.object({
  ownerIds: z.string().array(),
  regionIds: z.string().array(),
  catalogIds: z.string().array(),
  members: z.string().array(),
  playingSurfaceIds: z.string().array().optional(),
});

const parentConfig = createEntityConfig({
  name: TestEntity.PARENT,
  displayName: 'Parent',
  baseSchema: parentBaseSchema,
  mutual: {
    mutualSchema: parentMutualSchema,
    mutualFields: {
      ownerIds: { entityType: TestEntity.OWNER as unknown as EntityType },
      regionIds: { entityType: TestEntity.REGION as unknown as EntityType },
      catalogIds: {
        entityType: TestEntity.SEASON as unknown as EntityType,
      },
      members: { entityType: TestEntity.MEMBER as unknown as EntityType },
      playingSurfaceIds: { entityType: TestEntity.OWNER as unknown as EntityType },
    },
  },
});

const childEventConfig = createEntityConfig({
  name: TestEntity.CHILD_EVENT,
  displayName: 'Parent Event',
  baseSchema: z
    .object({
      parentId: z.string(),
      type: z.string(),
      eventTimestamp: z.string(),
    })
    .partial(),
  createSchema: z.object({
    parentId: z.string(),
    type: z.string(),
    eventTimestamp: z.string(),
  }),
  mutual: {
    mutualSchema: z.object({ parentIds: z.string().array() }),
    mutualFields: {
      parentIds: { entityType: TestEntity.PARENT as unknown as EntityType },
    },
  },
});

const EntityConfig: any = {
  [TestEntity.PARENT]: parentConfig,
  [TestEntity.CHILD_EVENT]: childEventConfig,
};

const PARENT = TestEntity.PARENT as unknown as EntityType;
const CHILD_EVENT = TestEntity.CHILD_EVENT as unknown as EntityType;

const PARENT_ID = '01ABCEXAMPLEPARENTID00000';

// The exact live-failing patch: state + status + both timeout counters, and
// none of the four mutual id lists.
const PARTIAL_UPDATE_PAYLOAD = {
  state: {
    period: 'Q1',
    time: '10:00',
    status: 'IN_PROGRESS' as const,
    isPaused: false,
  },
  status: 'IN_PROGRESS' as const,
  tallyA: 0,
  tallyB: 0,
};

const CHILD_EVENT_CREATE_PAYLOAD = {
  parentId: PARENT_ID,
  parentIds: [PARENT_ID],
  type: 'BEGIN_PHASE',
  eventTimestamp: '2026-01-01T00:00:00.000Z',
};

const zodFieldErrors = (err: unknown) =>
  err instanceof ZodError ? err.flatten().fieldErrors : undefined;

// ─── Transaction path (POST /core/transaction) ─────────────────────────────

describe('TransactionService — updateEntity validates its payload as a partial', () => {
  const publishEvent = vi.fn();
  const transactWriteItems = vi.fn();
  const getEntity = vi.fn();

  const buildService = () => {
    const entityRepository = {
      TABLE_NAME: 'test-table',
      createEntityTransactItems: vi.fn(() => [
        { Put: { TableName: 'test-table', Item: {} } },
      ]),
      toUpdate: vi.fn(() => ({
        UpdateExpression: 'SET #updatedAt = :updatedAt',
        ExpressionAttributeNames: { '#updatedAt': 'updatedAt' },
        ExpressionAttributeValues: { ':updatedAt': { S: 'now' } },
      })),
      getEntity,
    };

    return new TransactionService(
      EntityConfig,
      [],
      entityRepository as any,
      { transactWriteItems } as any,
      publishEvent as any,
      {} as any, // entityServiceLifeCycle — unused on these paths
      {} as any, // eventUtils — unused on these paths
    );
  };

  beforeEach(() => {
    publishEvent.mockReset().mockResolvedValue(undefined);
    transactWriteItems.mockReset().mockResolvedValue({});
    getEntity
      .mockReset()
      .mockResolvedValue({ data: { status: 'IN_PROGRESS' } });
  });

  it('accepts the real two-operation transaction that used to 400 (createEntity child-event + partial updateEntity parent)', async () => {
    const service = buildService();

    const result = await service.executeTransaction(
      [
        {
          operation: 'createEntity',
          entityType: CHILD_EVENT,
          payload: CHILD_EVENT_CREATE_PAYLOAD,
        },
        {
          operation: 'updateEntity',
          entityType: PARENT,
          entityId: PARENT_ID,
          payload: PARTIAL_UPDATE_PAYLOAD,
        },
      ] as any,
      'account-1',
    );

    expect(transactWriteItems).toHaveBeenCalledTimes(1);
    expect(result.results).toHaveLength(2);
    expect(result.results[1]).toMatchObject({
      operation: 'updateEntity',
      entityType: PARENT,
      entityId: PARENT_ID,
    });
  });

  it('emits no mutual-update event for a mutual field the patch never mentions', async () => {
    const service = buildService();

    await service.executeTransaction(
      [
        {
          operation: 'updateEntity',
          entityType: PARENT,
          entityId: PARENT_ID,
          payload: PARTIAL_UPDATE_PAYLOAD,
        },
      ] as any,
      'account-1',
    );

    const mutualEvents = publishEvent.mock.calls.filter(
      ([ev]) => ev.event === EVENT.CORE.ENTITY_MUTUAL_TO_UPDATE,
    );
    expect(mutualEvents).toHaveLength(0);

    // The ordinary update event must still fire.
    expect(publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: EVENT.CORE.ENTITY_UPDATED }),
    );
  });

  it('still rewires only the mutual fields the patch DOES supply', async () => {
    const service = buildService();

    await service.executeTransaction(
      [
        {
          operation: 'updateEntity',
          entityType: PARENT,
          entityId: PARENT_ID,
          payload: { ...PARTIAL_UPDATE_PAYLOAD, members: ['team-a', 'team-b'] },
        },
      ] as any,
      'account-1',
    );

    const mutualEvents = publishEvent.mock.calls
      .map(([ev]) => ev)
      .filter((ev) => ev.event === EVENT.CORE.ENTITY_MUTUAL_TO_UPDATE);

    expect(mutualEvents).toHaveLength(1);
    expect(mutualEvents[0].payload).toMatchObject({
      field: 'members',
      mutualIds: ['team-a', 'team-b'],
    });
  });

  it('still rejects a mutual field that IS present but wrongly typed', async () => {
    const service = buildService();

    const err = await service
      .executeTransaction(
        [
          {
            operation: 'updateEntity',
            entityType: PARENT,
            entityId: PARENT_ID,
            payload: { ...PARTIAL_UPDATE_PAYLOAD, members: 'team-a' },
          },
        ] as any,
        'account-1',
      )
      .catch((e) => e);

    expect(err).toBeInstanceOf(ZodError);
    expect(zodFieldErrors(err)).toHaveProperty('members');
    expect(transactWriteItems).not.toHaveBeenCalled();
  });

  it('still rejects a base field that IS present but wrongly typed', async () => {
    const service = buildService();

    const err = await service
      .executeTransaction(
        [
          {
            operation: 'updateEntity',
            entityType: PARENT,
            entityId: PARENT_ID,
            payload: { tallyA: 'two' },
          },
        ] as any,
        'account-1',
      )
      .catch((e) => e);

    expect(err).toBeInstanceOf(ZodError);
    expect(zodFieldErrors(err)).toHaveProperty('tallyA');
    expect(transactWriteItems).not.toHaveBeenCalled();
  });

  it('still rejects a present-but-incomplete nested object — partial is shallow, not deep', async () => {
    const service = buildService();

    const err = await service
      .executeTransaction(
        [
          {
            operation: 'updateEntity',
            entityType: PARENT,
            entityId: PARENT_ID,
            payload: { state: { period: 'Q1' } },
          },
        ] as any,
        'account-1',
      )
      .catch((e) => e);

    expect(err).toBeInstanceOf(ZodError);
    expect(zodFieldErrors(err)).toHaveProperty('state');
    expect(transactWriteItems).not.toHaveBeenCalled();
  });

  it('leaves createEntity strict — a create still requires every mutual field', async () => {
    const service = buildService();

    const err = await service
      .executeTransaction(
        [
          {
            operation: 'createEntity',
            entityType: PARENT,
            payload: { status: 'UPCOMING' }, // no mutual ids at all
          },
        ] as any,
        'account-1',
      )
      .catch((e) => e);

    expect(err).toBeInstanceOf(ZodError);
    expect(zodFieldErrors(err)).toMatchObject({
      ownerIds: ['Required'],
      regionIds: ['Required'],
      catalogIds: ['Required'],
      members: ['Required'],
    });
    expect(transactWriteItems).not.toHaveBeenCalled();
  });

  it('leaves createEntity strict — a create that supplies every mutual field still succeeds', async () => {
    const service = buildService();

    await service.executeTransaction(
      [
        {
          operation: 'createEntity',
          entityType: PARENT,
          payload: {
            status: 'UPCOMING',
            ownerIds: ['owner-1'],
            regionIds: ['region-1'],
            catalogIds: ['season-1'],
            members: ['team-a', 'team-b'],
          },
        },
      ] as any,
      'account-1',
    );

    expect(transactWriteItems).toHaveBeenCalledTimes(1);
    const mutualEvents = publishEvent.mock.calls
      .map(([ev]) => ev)
      .filter((ev) => ev.event === EVENT.CORE.ENTITY_MUTUAL_TO_CREATE);
    expect(mutualEvents).toHaveLength(4);
  });
});

// ─── Non-transactional path (PATCH /core/entity/:type/:id) ──────────────────

describe('EntityService.updateEntity — validates its payload as a partial', () => {
  const publishEvent = vi.fn();
  const updateEntity = vi.fn();
  const createEntity = vi.fn();

  const buildService = () => {
    const entityRepository = {
      updateEntity,
      createEntity,
      getEntity: vi.fn().mockResolvedValue({ data: {} }),
      getEmailAvailability: vi.fn().mockResolvedValue(undefined),
    };

    return new EntityService(
      EntityConfig,
      [],
      entityRepository as any,
      publishEvent as any,
      { afterCreateEntityHook: vi.fn().mockResolvedValue(undefined) } as any,
    );
  };

  beforeEach(() => {
    publishEvent.mockReset().mockResolvedValue(undefined);
    updateEntity.mockReset().mockResolvedValue({
      entityType: PARENT,
      entityId: PARENT_ID,
      data: PARTIAL_UPDATE_PAYLOAD,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    createEntity.mockReset().mockResolvedValue({
      entityType: PARENT,
      entityId: PARENT_ID,
      data: {},
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('accepts a patch that omits every mutual field', async () => {
    const service = buildService();

    await service.updateEntity({
      entityType: PARENT,
      entityId: PARENT_ID,
      entityPayload: PARTIAL_UPDATE_PAYLOAD as any,
    });

    expect(updateEntity).toHaveBeenCalledTimes(1);
    // Only the keys actually sent reach the repository — the patch must not
    // grow fields the caller never mentioned.
    expect(updateEntity.mock.calls[0][2]).toEqual({
      data: PARTIAL_UPDATE_PAYLOAD,
    });
  });

  // Regression guard for the hole partial parsing opens up: `.parse()` STRIPS
  // unknown keys, so for a non-`.partial()` baseSchema a typo'd field name no
  // longer fails on the missing required fields — it parses to `{}`. Without an
  // explicit check that is a silent 200 that writes nothing, bumps `updatedAt`
  // and publishes `entity-updated`.
  it('rejects a patch whose keys are all unrecognised, rather than writing nothing', async () => {
    const service = buildService();

    await expect(
      service.updateEntity({
        entityType: PARENT,
        entityId: PARENT_ID,
        entityPayload: { totallyUnknown: 1 } as any,
      }),
    ).rejects.toMatchObject({ name: 'ZodError' });

    expect(updateEntity).not.toHaveBeenCalled();
  });

  it('rejects a completely empty patch', async () => {
    const service = buildService();

    await expect(
      service.updateEntity({
        entityType: PARENT,
        entityId: PARENT_ID,
        entityPayload: {} as any,
      }),
    ).rejects.toMatchObject({ name: 'ZodError' });

    expect(updateEntity).not.toHaveBeenCalled();
  });

  // The other half of the guard: a body of ONLY mutual fields parses to an
  // empty BASE payload, but is a legitimate patch — it rewires relationships.
  // Emptiness of one side alone must not reject.
  it('accepts a patch made up entirely of mutual fields', async () => {
    const service = buildService();

    await service.updateEntity({
      entityType: PARENT,
      entityId: PARENT_ID,
      entityPayload: { ownerIds: ['owner-1'] } as any,
    });

    expect(updateEntity).toHaveBeenCalledTimes(1);
    const mutualEvents = publishEvent.mock.calls
      .map(([ev]) => ev)
      .filter((ev) => ev.event === EVENT.CORE.ENTITY_MUTUAL_TO_UPDATE);
    expect(mutualEvents).toHaveLength(1);
    expect(mutualEvents[0].payload.field).toBe('ownerIds');
  });

  it('emits no mutual-update event for a mutual field the patch never mentions', async () => {
    const service = buildService();

    await service.updateEntity({
      entityType: PARENT,
      entityId: PARENT_ID,
      entityPayload: PARTIAL_UPDATE_PAYLOAD as any,
    });

    const mutualEvents = publishEvent.mock.calls
      .map(([ev]) => ev)
      .filter((ev) => ev.event === EVENT.CORE.ENTITY_MUTUAL_TO_UPDATE);
    expect(mutualEvents).toHaveLength(0);
    expect(publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: EVENT.CORE.ENTITY_UPDATED }),
    );
  });

  it('still rewires only the mutual fields the patch DOES supply', async () => {
    const service = buildService();

    await service.updateEntity({
      entityType: PARENT,
      entityId: PARENT_ID,
      entityPayload: { ...PARTIAL_UPDATE_PAYLOAD, members: ['team-a'] } as any,
    });

    const mutualEvents = publishEvent.mock.calls
      .map(([ev]) => ev)
      .filter((ev) => ev.event === EVENT.CORE.ENTITY_MUTUAL_TO_UPDATE);

    expect(mutualEvents).toHaveLength(1);
    expect(mutualEvents[0].payload).toMatchObject({
      field: 'members',
      mutualIds: ['team-a'],
    });
  });

  it('still rejects a mutual field that IS present but wrongly typed', async () => {
    const service = buildService();

    const err = await service
      .updateEntity({
        entityType: PARENT,
        entityId: PARENT_ID,
        entityPayload: { ...PARTIAL_UPDATE_PAYLOAD, members: [1, 2] } as any,
      })
      .catch((e) => e);

    expect(err).toBeInstanceOf(ZodError);
    expect(zodFieldErrors(err)).toHaveProperty('members');
    expect(updateEntity).not.toHaveBeenCalled();
  });

  it('still rejects a base field that IS present but wrongly typed', async () => {
    const service = buildService();

    const err = await service
      .updateEntity({
        entityType: PARENT,
        entityId: PARENT_ID,
        entityPayload: { status: 'NOT_A_REAL_STATUS' } as any,
      })
      .catch((e) => e);

    expect(err).toBeInstanceOf(ZodError);
    expect(zodFieldErrors(err)).toHaveProperty('status');
    expect(updateEntity).not.toHaveBeenCalled();
  });

  it('leaves createEntity strict — a create still requires every mutual field', async () => {
    const service = buildService();

    const err = await service
      .createEntity({
        entityType: PARENT,
        entityPayload: { status: 'UPCOMING' } as any,
      })
      .catch((e) => e);

    expect(err).toBeInstanceOf(ZodError);
    expect(zodFieldErrors(err)).toMatchObject({
      ownerIds: ['Required'],
      regionIds: ['Required'],
      catalogIds: ['Required'],
      members: ['Required'],
    });
    expect(createEntity).not.toHaveBeenCalled();
  });

  it('leaves createEntity strict — a create that supplies every mutual field still succeeds', async () => {
    const service = buildService();

    await service.createEntity({
      entityType: PARENT,
      entityPayload: {
        status: 'UPCOMING',
        ownerIds: ['owner-1'],
        regionIds: ['region-1'],
        catalogIds: ['season-1'],
        members: ['team-a'],
      } as any,
    });

    expect(createEntity).toHaveBeenCalledTimes(1);
  });

  it('leaves createEntity strict for a required base field too', async () => {
    const service = buildService();

    // CHILD_EVENT's createSchema requires parentId/type/eventTimestamp; the
    // update path forgives all three, the create path must not.
    const err = await service
      .createEntity({
        entityType: CHILD_EVENT,
        entityPayload: { type: 'BEGIN_PHASE', parentIds: [PARENT_ID] } as any,
      })
      .catch((e) => e);

    expect(err).toBeInstanceOf(ZodError);
    expect(zodFieldErrors(err)).toMatchObject({
      parentId: ['Required'],
      eventTimestamp: ['Required'],
    });

    await service.updateEntity({
      entityType: CHILD_EVENT,
      entityId: 'evt-1',
      entityPayload: { type: 'END_PERIOD' } as any,
    });
    expect(updateEntity).toHaveBeenCalledTimes(1);
  });
});
