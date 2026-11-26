import {
  type DynamoDB,
  TransactionCanceledException,
} from '@aws-sdk/client-dynamodb';
import type { Entity as EntityType } from '@monorise/base';
import { describe, expect, it, vi } from 'vitest';
import { StandardErrorCode } from '../../errors/standard-error';
import { DbUtils } from '../DbUtils';
import { EntityRepository } from '../Entity';

// A stubbed client: what matters is how a cancelled transaction is reported.
const cancelled = (...codes: string[]) =>
  new TransactionCanceledException({
    message: 'Transaction cancelled',
    $metadata: {},
    CancellationReasons: codes.map((Code) => ({ Code })),
  });

const user = 'user' as unknown as EntityType;
const repositoryWith = (transactWriteItems: ReturnType<typeof vi.fn>) =>
  new EntityRepository(
    // biome-ignore lint/suspicious/noExplicitAny: only uniqueFields is read
    { user: { uniqueFields: ['email'] } } as any,
    'table',
    { transactWriteItems } as unknown as DynamoDB,
    [],
  );

describe('cancelled transactions', () => {
  it('reports a create that lost a race for the same item as TRANSACTION_CONFLICT', async () => {
    const transactWriteItems = vi
      .fn()
      .mockRejectedValue(cancelled('None', 'None', 'TransactionConflict'));

    await expect(
      repositoryWith(transactWriteItems).createEntity(user, {
        email: 'a@b.co',
      } as never),
    ).rejects.toMatchObject({ code: StandardErrorCode.TRANSACTION_CONFLICT });
  });

  it('still reports a taken unique value as UNIQUE_VALUE_EXISTS', async () => {
    const transactWriteItems = vi
      .fn()
      .mockRejectedValue(cancelled('None', 'None', 'ConditionalCheckFailed'));

    await expect(
      repositoryWith(transactWriteItems).createEntity(user, {
        email: 'a@b.co',
      } as never),
    ).rejects.toMatchObject({ code: StandardErrorCode.UNIQUE_VALUE_EXISTS });
  });

  it('reports a conflict in executeTransactWrite as TRANSACTION_CONFLICT', async () => {
    const dbUtils = new DbUtils({
      transactWriteItems: vi
        .fn()
        .mockRejectedValue(cancelled('None', 'TransactionConflict')),
    } as unknown as DynamoDB);

    await expect(
      dbUtils.executeTransactWrite({ TransactItems: [] }),
    ).rejects.toMatchObject({ code: StandardErrorCode.TRANSACTION_CONFLICT });
  });
});
