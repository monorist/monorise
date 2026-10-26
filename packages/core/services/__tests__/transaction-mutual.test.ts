import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { type Entity as EntityType, createEntityConfig } from '../../../base';
import { TransactionService } from '../transaction.service';

// The LocalStack coverage for createMutual / deleteMutual lives in
// data/__tests__/TransactionMutualHttp.test.ts. This file covers what that
// can't easily reach: the asEntity post-commit hook's ordering, and a
// TransactionService built without a MutualService.
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

const createMutualOp = {
  operation: 'createMutual' as const,
  byEntityType: 'student' as unknown as EntityType,
  byEntityId: 's1',
  entityType: 'course' as unknown as EntityType,
  entityId: 'c1',
  payload: { name: 'Ada' },
};

const buildService = (overrides: { mutualService?: object } = {}) => {
  const calls: string[] = [];
  const transactWriteItems = vi.fn(async () => {
    calls.push('commit');
    return {};
  });
  const publishEvent = vi.fn(async () => {
    calls.push('publish');
  });
  const afterCreateEntityHook = vi.fn(async () => {
    calls.push('afterCreateEntityHook');
  });
  const service = new TransactionService(
    EntityConfig,
    [],
    {} as never, // entityRepository
    { transactWriteItems } as never,
    publishEvent as never,
    { afterCreateEntityHook } as never,
    {} as never, // eventUtils
    overrides.mutualService as never,
  );
  return {
    service,
    calls,
    transactWriteItems,
    publishEvent,
    afterCreateEntityHook,
  };
};

describe('TransactionService — mutual operations', () => {
  it('runs an asEntity projection hook after the commit and before publishing', async () => {
    const projection = { entityType: 'enrollment', entityId: 'm1' };
    const mutualService = {
      prepareCreateMutual: vi.fn(async () => ({
        mutual: {
          mutualId: 'm1',
          data: { title: 'Maths' },
          mutualData: { name: 'Ada' },
          createdAt: '2026-10-26T00:00:00.000Z',
          updatedAt: '2026-10-26T00:00:00.000Z',
          mutualUpdatedAt: '2026-10-26T00:00:00.000Z',
        },
        entity: projection,
        transactItems: [{ Put: { TableName: 't', Item: {} } }],
        parsedMutualPayload: { name: 'Ada' },
      })),
    };
    const { service, calls, transactWriteItems, afterCreateEntityHook } =
      buildService({ mutualService });

    const { results } = await service.executeTransaction(
      [createMutualOp],
      'acc-1',
    );

    expect(transactWriteItems).toHaveBeenCalledWith({
      TransactItems: [{ Put: { TableName: 't', Item: {} } }],
    });
    expect(afterCreateEntityHook).toHaveBeenCalledWith(
      projection,
      { name: 'Ada' },
      'acc-1',
    );
    expect(calls).toEqual(['commit', 'afterCreateEntityHook', 'publish']);
    expect(results[0]).toMatchObject({
      operation: 'createMutual',
      mutualId: 'm1',
      mutualData: { name: 'Ada' },
    });
  });

  it('defaults a missing payload to an empty object', async () => {
    const mutualService = {
      prepareCreateMutual: vi.fn(async () => ({
        mutual: { mutualId: 'm1', data: {}, mutualData: {} },
        transactItems: [],
        parsedMutualPayload: {},
      })),
    };
    const { service } = buildService({ mutualService });
    const { payload: _payload, ...withoutPayload } = createMutualOp;

    await service.executeTransaction([withoutPayload]);

    expect(mutualService.prepareCreateMutual).toHaveBeenCalledWith(
      expect.objectContaining({ mutualPayload: {} }),
    );
  });

  it('rejects mutual operations when built without a MutualService', async () => {
    const { service, transactWriteItems } = buildService();

    await expect(
      service.executeTransaction([createMutualOp]),
    ).rejects.toMatchObject({ code: 'TRANSACTION_INVALID_OPERATION' });
    expect(transactWriteItems).not.toHaveBeenCalled();
  });
});
