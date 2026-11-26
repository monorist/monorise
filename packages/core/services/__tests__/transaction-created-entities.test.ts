import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { type Entity as EntityType, createEntityConfig } from '../../../base';
import { MutualService, entityInTransactionKey } from '../mutual.service';
import { TransactionService } from '../transaction.service';

// A transactional createMutual that links to an entity created earlier in
// the same transaction: that entity isn't in the table until the commit, so
// its data has to come from the transaction itself.
const student = 'student' as unknown as EntityType;
const course = 'course' as unknown as EntityType;

const EntityConfig = {
  student: createEntityConfig({
    name: 'student',
    displayName: 'Student',
    baseSchema: z.object({ name: z.string() }).partial(),
  }),
  course: createEntityConfig({
    name: 'course',
    displayName: 'Course',
    baseSchema: z.object({ title: z.string() }).partial(),
  }),
} as unknown as Record<EntityType, ReturnType<typeof createEntityConfig>>;

describe('createMutual with an entity created in the same transaction', () => {
  it('takes that entity from the transaction instead of reading it', async () => {
    const entityRepository = {
      getEntity: vi.fn().mockResolvedValue({ data: { name: 'Ada' } }),
      createEntityTransactItems: vi.fn().mockReturnValue([]),
    };
    const service = new MutualService(
      EntityConfig as never,
      entityRepository as never,
      {
        checkMutualExist: vi.fn().mockResolvedValue(undefined),
        createMutualTransactItems: vi.fn().mockReturnValue([]),
      } as never,
      vi.fn() as never,
      {} as never,
      {} as never,
    );

    const { mutual } = await service.prepareCreateMutual({
      byEntityType: student,
      byEntityId: 's1',
      entityType: course,
      entityId: 'c1',
      mutualPayload: {},
      options: {
        entitiesInTransaction: new Map([
          [entityInTransactionKey(course, 'c1'), { title: 'Maths' }],
        ]),
      },
    });

    // Only the student, which already exists, is read.
    expect(entityRepository.getEntity).toHaveBeenCalledTimes(1);
    expect(entityRepository.getEntity).toHaveBeenCalledWith(student, 's1');
    expect(mutual.byData).toEqual({ name: 'Ada' });
    expect(mutual.data).toEqual({ title: 'Maths' });
  });

  it('passes the entities a transaction creates to its createMutual operations', async () => {
    const prepareCreateMutual = vi.fn(async () => ({
      mutual: {
        mutualId: 'm1',
        data: { title: 'Maths' },
        mutualData: {},
        createdAt: '2026-11-26T00:00:00.000Z',
        updatedAt: '2026-11-26T00:00:00.000Z',
        mutualUpdatedAt: '2026-11-26T00:00:00.000Z',
      },
      entity: undefined,
      transactItems: [],
      parsedMutualPayload: {},
    }));
    const service = new TransactionService(
      EntityConfig,
      [],
      {
        createEntityTransactItems: () => [
          { Put: { TableName: 't', Item: {} } },
        ],
      } as never,
      { transactWriteItems: vi.fn(async () => ({})) } as never,
      vi.fn(async () => {}) as never,
      { afterCreateEntityHook: vi.fn() } as never,
      {} as never,
      { prepareCreateMutual } as never,
    );

    // The createMutual comes first: the order inside one transaction doesn't
    // matter, since it all commits together.
    await service.executeTransaction([
      {
        operation: 'createMutual',
        byEntityType: student,
        byEntityId: 's1',
        entityType: course,
        entityId: 'c1',
      },
      {
        operation: 'createEntity',
        entityType: course,
        entityId: 'c1',
        payload: { title: 'Maths' },
      },
    ] as never);

    expect(prepareCreateMutual).toHaveBeenCalledWith(
      expect.objectContaining({
        options: {
          entitiesInTransaction: new Map([['course#c1', { title: 'Maths' }]]),
        },
      }),
    );
  });
});
