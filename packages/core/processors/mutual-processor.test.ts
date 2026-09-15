import type { SQSEvent } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createEntityConfig, createMutualConfig } from '../../base';
import type { Entity as EntityType } from '../../base';
import { StandardError, StandardErrorCode } from '../errors/standard-error';
import type { DependencyContainer } from '../services/DependencyContainer';
import { EVENT } from '../types/event';
import { type EventDetailBody, handler } from './mutual-processor';

enum TestEntity {
  STUDENT = 'student',
  COURSE = 'course',
  ENROLLMENT = 'enrollment',
  BADGE = 'badge',
}

const enrollmentEntityConfig = createEntityConfig({
  name: TestEntity.ENROLLMENT,
  displayName: 'Enrollment',
  baseSchema: z.object({ role: z.string() }).partial(),
  createSchema: z.object({ role: z.string() }),
});

const mutualWithoutAsEntity = createMutualConfig({
  entities: [
    TestEntity.STUDENT as unknown as EntityType,
    TestEntity.COURSE as unknown as EntityType,
  ],
  mutualDataSchema: z.object({ role: z.string() }),
});

const mutualWithAsEntitySync = createMutualConfig({
  entities: [
    TestEntity.STUDENT as unknown as EntityType,
    TestEntity.COURSE as unknown as EntityType,
  ],
  asEntity: enrollmentEntityConfig,
  ensureEntityStrongConsistentWrite: true,
});

const mutualWithAsEntityAsync = createMutualConfig({
  entities: [
    TestEntity.STUDENT as unknown as EntityType,
    TestEntity.COURSE as unknown as EntityType,
  ],
  asEntity: enrollmentEntityConfig,
  // ensureEntityStrongConsistentWrite omitted — defaults to the async CREATE_ENTITY event path.
});

// ENROLLMENT declaring its OWN further mutualFields (to BADGE) is exactly the scenario storage
// narrowing protects against: `enrollmentWithBadgesConfig.finalSchema` includes `badgeIds` (via
// `effectiveMutualSchema`), so the derived `mutualDataSchema` for the STUDENT<->COURSE mutual
// below also includes it — but `badgeIds` must never be what's actually PERSISTED as this
// mutual's `mutualData` or the synthetic ENROLLMENT entity's `data`.
const enrollmentBadgeMutual = createMutualConfig({
  entities: [
    TestEntity.ENROLLMENT as unknown as EntityType,
    TestEntity.BADGE as unknown as EntityType,
  ],
  mutualDataSchema: z.object({}),
});

const enrollmentWithBadgesConfig = createEntityConfig({
  name: TestEntity.ENROLLMENT,
  displayName: 'Enrollment',
  baseSchema: z.object({ role: z.string() }).partial(),
  createSchema: z.object({ role: z.string() }),
  mutual: {
    mutualSchema: z.object({ badgeIds: z.string().array() }).partial(),
    mutualFields: {
      badgeIds: {
        entityType: TestEntity.BADGE as unknown as EntityType,
        mutual: enrollmentBadgeMutual,
      },
    },
  },
});

const mutualWithAsEntityAndFurtherMutualFields = createMutualConfig({
  entities: [
    TestEntity.STUDENT as unknown as EntityType,
    TestEntity.COURSE as unknown as EntityType,
  ],
  asEntity: enrollmentWithBadgesConfig,
  ensureEntityStrongConsistentWrite: true,
});

function buildContainer(
  mutualConfig: ReturnType<typeof createMutualConfig>,
  opts: {
    mutualDataProcessor?: (...args: any[]) => Record<string, unknown>;
    getEntity?: ReturnType<typeof vi.fn>;
    listEntitiesByEntity?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const EntityConfig = {
    [TestEntity.STUDENT]: createEntityConfig({
      name: TestEntity.STUDENT,
      displayName: 'Student',
      baseSchema: z.object({ name: z.string() }).partial(),
      mutual: {
        mutualSchema: z.object({ courseIds: z.string().array() }).partial(),
        mutualFields: {
          courseIds: {
            entityType: TestEntity.COURSE as unknown as EntityType,
            mutual: mutualConfig,
            // Without a processor, mutualDataProcessor defaults to `() => ({})`, which would
            // fail every mutualDataSchema here (all of them require `role`).
            mutualDataProcessor: opts.mutualDataProcessor ?? (() => ({ role: 'student' })),
          },
        },
      },
    }),
    [TestEntity.COURSE]: createEntityConfig({
      name: TestEntity.COURSE,
      displayName: 'Course',
      baseSchema: z.object({ title: z.string() }).partial(),
    }),
    [TestEntity.ENROLLMENT]: enrollmentEntityConfig,
    [TestEntity.BADGE]: createEntityConfig({
      name: TestEntity.BADGE,
      displayName: 'Badge',
      baseSchema: z.object({ label: z.string() }).partial(),
    }),
  } as any;

  const entityRepository = {
    getEntity: opts.getEntity ?? vi.fn().mockResolvedValue({ data: {} }),
    createEntityTransactItems: vi.fn().mockReturnValue([
      { Put: { TableName: 'test', Item: { tag: 'entity-1' } } },
      { Put: { TableName: 'test', Item: { tag: 'entity-2' } } },
    ]),
  };
  const mutualRepository = {
    createMutualLock: vi.fn().mockResolvedValue(undefined),
    deleteMutualLock: vi.fn().mockResolvedValue(undefined),
    listEntitiesByEntity:
      opts.listEntitiesByEntity ?? vi.fn().mockResolvedValue({ items: [] }),
    createMutualTransactItems: vi.fn().mockReturnValue([
      { Put: { TableName: 'test', Item: { tag: 'mutual-1' } } },
      { Put: { TableName: 'test', Item: { tag: 'mutual-2' } } },
      { Put: { TableName: 'test', Item: { tag: 'mutual-3' } } },
    ]),
    createMutual: vi.fn().mockResolvedValue(undefined),
    updateMutual: vi.fn().mockResolvedValue(undefined),
  };
  const dynamodbClient = {
    transactWriteItems: vi.fn().mockResolvedValue(undefined),
  };
  const entityServiceLifeCycle = {
    afterCreateEntityHook: vi.fn().mockResolvedValue(undefined),
  };
  const publishEvent = vi.fn().mockResolvedValue(undefined);

  const container = {
    config: { EntityConfig },
    entityRepository,
    mutualRepository,
    publishEvent,
    dynamodbClient,
    entityServiceLifeCycle,
  } as unknown as DependencyContainer;

  return {
    container,
    entityRepository,
    mutualRepository,
    dynamodbClient,
    entityServiceLifeCycle,
    publishEvent,
  };
}

function buildEvent(overrides: Partial<EventDetailBody> = {}): SQSEvent {
  const detail: EventDetailBody = {
    mutualIds: ['course-1'],
    byEntityType: TestEntity.STUDENT as unknown as EntityType,
    byEntityId: 'student-1',
    entityType: TestEntity.COURSE as unknown as EntityType,
    field: 'courseIds',
    publishedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };

  return {
    Records: [
      {
        messageId: 'msg-1',
        body: JSON.stringify({
          source: EVENT.CORE.ENTITY_MUTUAL_TO_CREATE.Source,
          'detail-type': EVENT.CORE.ENTITY_MUTUAL_TO_CREATE.DetailType,
          detail,
        }),
      },
    ],
  } as unknown as SQSEvent;
}

const createEntityEventCalls = (publishEvent: ReturnType<typeof vi.fn>) =>
  publishEvent.mock.calls.filter(
    ([arg]) => arg.event?.DetailType === EVENT.CORE.CREATE_ENTITY.DetailType,
  );

describe('mutual-processor handler — asEntity (declarative mutualFields path)', () => {
  it('creates the synthetic entity synchronously in the SAME transaction and fires afterCreateEntityHook when ensureEntityStrongConsistentWrite is true', async () => {
    const { container, mutualRepository, dynamodbClient, entityServiceLifeCycle, publishEvent } =
      buildContainer(mutualWithAsEntitySync);

    const result = await handler(container)(buildEvent());

    expect(result.batchItemFailures).toEqual([]);
    // The old low-level path must NOT be used once asEntity is set.
    expect(mutualRepository.createMutual).not.toHaveBeenCalled();

    expect(dynamodbClient.transactWriteItems).toHaveBeenCalledTimes(1);
    const { TransactItems } = dynamodbClient.transactWriteItems.mock.calls[0][0];
    // 3 mutual Put items + 2 entity Put items, merged into one transaction.
    expect(TransactItems).toHaveLength(5);

    expect(entityServiceLifeCycle.afterCreateEntityHook).toHaveBeenCalledTimes(1);
    const [entityArg, payloadArg] = entityServiceLifeCycle.afterCreateEntityHook.mock.calls[0];
    expect(entityArg.entityType).toBe(TestEntity.ENROLLMENT);
    expect(payloadArg).toMatchObject({ role: expect.any(String) });

    expect(createEntityEventCalls(publishEvent)).toHaveLength(0);
  });

  it('publishes an async CREATE_ENTITY event (only mutual items in the transaction) and does not call afterCreateEntityHook when ensureEntityStrongConsistentWrite is false/omitted', async () => {
    const { container, mutualRepository, dynamodbClient, entityServiceLifeCycle, publishEvent } =
      buildContainer(mutualWithAsEntityAsync);

    const result = await handler(container)(buildEvent());

    expect(result.batchItemFailures).toEqual([]);
    expect(mutualRepository.createMutual).not.toHaveBeenCalled();

    expect(dynamodbClient.transactWriteItems).toHaveBeenCalledTimes(1);
    const { TransactItems } = dynamodbClient.transactWriteItems.mock.calls[0][0];
    // Only the 3 mutual Put items — no entity transact items when not strongly consistent.
    expect(TransactItems).toHaveLength(3);

    expect(entityServiceLifeCycle.afterCreateEntityHook).not.toHaveBeenCalled();

    const calls = createEntityEventCalls(publishEvent);
    expect(calls).toHaveLength(1);
    expect(calls[0][0].payload).toMatchObject({ entityType: TestEntity.ENROLLMENT });
  });

  it('regression: a mutual config without asEntity uses the old mutualRepository.createMutual path, completely unchanged', async () => {
    const { container, mutualRepository, dynamodbClient, entityServiceLifeCycle, publishEvent } =
      buildContainer(mutualWithoutAsEntity);

    const result = await handler(container)(buildEvent());

    expect(result.batchItemFailures).toEqual([]);
    expect(mutualRepository.createMutual).toHaveBeenCalledTimes(1);
    // None of the new asEntity machinery should ever be touched for this config.
    expect(dynamodbClient.transactWriteItems).not.toHaveBeenCalled();
    expect(entityServiceLifeCycle.afterCreateEntityHook).not.toHaveBeenCalled();
    expect(createEntityEventCalls(publishEvent)).toHaveLength(0);
  });

  it("storage narrowing: the target entity's own further-mutualFields keys (badgeIds) never get persisted as mutualData or entity data, but afterCreateEntityHook still receives them", async () => {
    const { container, mutualRepository, entityRepository, entityServiceLifeCycle } =
      buildContainer(mutualWithAsEntityAndFurtherMutualFields, {
        // Simulates a mutualDataProcessor that (deliberately or not) returns data shaped like
        // ENROLLMENT's OWN further mutualFields output, not just its own baseSchema/createSchema.
        mutualDataProcessor: () => ({ role: 'student', badgeIds: ['badge-1'] }),
      });

    const result = await handler(container)(buildEvent());

    expect(result.batchItemFailures).toEqual([]);

    const storedMutual = mutualRepository.createMutualTransactItems.mock.calls[0][0];
    expect(storedMutual.mutualData).toEqual({ role: 'student' });
    expect(storedMutual.mutualData).not.toHaveProperty('badgeIds');

    const storedEntity = entityRepository.createEntityTransactItems.mock.calls[0][0];
    expect(storedEntity.data).toEqual({ role: 'student' });
    expect(storedEntity.data).not.toHaveProperty('badgeIds');

    // The hook needs the FULLER shape to wire ENROLLMENT's own further mutualFields (badgeIds) —
    // narrowing storage must not narrow this.
    const [, hookPayload] = entityServiceLifeCycle.afterCreateEntityHook.mock.calls[0];
    expect(hookPayload).toMatchObject({ role: 'student', badgeIds: ['badge-1'] });
  });

  it('self-heal: toUpdateEntityIds re-publishes CREATE_ENTITY when a prior attempt left the mutual created but the synthetic entity missing', async () => {
    const existingMutualId = 'existing-mutual-ulid-1';
    // Only the self-heal check's own lookup (ENROLLMENT by mutualId) should miss — the ordinary
    // byEntity/entity lookups (STUDENT/COURSE) this handler also makes must keep resolving
    // normally, or the handler fails before ever reaching the self-heal logic under test.
    const getEntity = vi.fn().mockImplementation((entityType: string) => {
      if (entityType === TestEntity.ENROLLMENT) {
        return Promise.reject(
          new StandardError(StandardErrorCode.ENTITY_IS_UNDEFINED, 'Entity item empty'),
        );
      }
      return Promise.resolve({ data: {} });
    });
    const listEntitiesByEntity = vi.fn().mockResolvedValue({
      items: [{ entityId: 'course-1', mutualId: existingMutualId }],
    });

    const { container, publishEvent } = buildContainer(mutualWithAsEntityAsync, {
      getEntity,
      listEntitiesByEntity,
    });

    // `mutualIds: ['course-1']` matches the already-existing item above, so this lands in
    // `toUpdateEntityIds`, not `addedEntityIds`.
    const result = await handler(container)(buildEvent({ mutualIds: ['course-1'] }));

    expect(result.batchItemFailures).toEqual([]);
    expect(getEntity).toHaveBeenCalledWith(TestEntity.ENROLLMENT, existingMutualId);

    const calls = createEntityEventCalls(publishEvent);
    expect(calls).toHaveLength(1);
    expect(calls[0][0].payload).toMatchObject({
      entityType: TestEntity.ENROLLMENT,
      entityId: existingMutualId,
    });
  });

  it('self-heal: toUpdateEntityIds does NOT re-publish CREATE_ENTITY when the synthetic entity already exists (ordinary update, not a retry)', async () => {
    const existingMutualId = 'existing-mutual-ulid-2';
    const getEntity = vi.fn().mockResolvedValue({ data: { role: 'student' } });
    const listEntitiesByEntity = vi.fn().mockResolvedValue({
      items: [{ entityId: 'course-1', mutualId: existingMutualId }],
    });

    const { container, publishEvent } = buildContainer(mutualWithAsEntityAsync, {
      getEntity,
      listEntitiesByEntity,
    });

    const result = await handler(container)(buildEvent({ mutualIds: ['course-1'] }));

    expect(result.batchItemFailures).toEqual([]);
    expect(getEntity).toHaveBeenCalledWith(TestEntity.ENROLLMENT, existingMutualId);
    expect(createEntityEventCalls(publishEvent)).toHaveLength(0);
  });
});
