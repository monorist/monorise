import type { SQSEvent } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createEntityConfig, createMutualConfig } from '../../base';
import type { Entity as EntityType } from '../../base';
import type { DependencyContainer } from '../services/DependencyContainer';
import { EVENT } from '../types/event';
import { type EventDetailBody, handler } from './mutual-processor';

enum TestEntity {
  STUDENT = 'student',
  COURSE = 'course',
  ENROLLMENT = 'enrollment',
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

function buildContainer(mutualConfig: ReturnType<typeof createMutualConfig>) {
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
            mutualDataProcessor: () => ({ role: 'student' }),
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
  } as any;

  const entityRepository = {
    getEntity: vi.fn().mockResolvedValue({ data: {} }),
    createEntityTransactItems: vi.fn().mockReturnValue([
      { Put: { TableName: 'test', Item: { tag: 'entity-1' } } },
      { Put: { TableName: 'test', Item: { tag: 'entity-2' } } },
    ]),
  };
  const mutualRepository = {
    createMutualLock: vi.fn().mockResolvedValue(undefined),
    deleteMutualLock: vi.fn().mockResolvedValue(undefined),
    listEntitiesByEntity: vi.fn().mockResolvedValue({ items: [] }),
    createMutualTransactItems: vi.fn().mockReturnValue([
      { Put: { TableName: 'test', Item: { tag: 'mutual-1' } } },
      { Put: { TableName: 'test', Item: { tag: 'mutual-2' } } },
      { Put: { TableName: 'test', Item: { tag: 'mutual-3' } } },
    ]),
    createMutual: vi.fn().mockResolvedValue(undefined),
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
});
