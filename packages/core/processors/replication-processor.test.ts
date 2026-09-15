import { describe, expect, it, vi } from 'vitest';
import type { DependencyContainer } from '../services/DependencyContainer';
import { handler } from './replication-processor';

function buildContainer(overrides: {
  query?: ReturnType<typeof vi.fn>;
  updateItem?: ReturnType<typeof vi.fn>;
  deleteItem?: ReturnType<typeof vi.fn>;
} = {}) {
  const dynamodbClient = {
    query: overrides.query ?? vi.fn().mockResolvedValue({ Items: [] }),
    updateItem: overrides.updateItem ?? vi.fn().mockResolvedValue({}),
    deleteItem: overrides.deleteItem ?? vi.fn().mockResolvedValue({}),
  };

  const container = {
    coreTable: 'test-table',
    dynamodbClient,
  } as unknown as DependencyContainer;

  return { container, dynamodbClient };
}

function buildMutualModifyRecord(overrides: {
  mutualId?: string;
  expiresAt?: string;
  mutualData?: Record<string, { S: string }>;
  mutualUpdatedAt?: string;
} = {}) {
  const mutualId = overrides.mutualId ?? 'mutual-1';

  return {
    eventName: 'MODIFY',
    dynamodb: {
      NewImage: {
        PK: { S: `MUTUAL#${mutualId}` },
        SK: { S: '#METADATA#' },
        mutualUpdatedAt: { S: overrides.mutualUpdatedAt ?? '2026-01-01T00:00:00.000Z' },
        ...(overrides.expiresAt ? { expiresAt: { N: overrides.expiresAt } } : {}),
        ...(overrides.mutualData ? { mutualData: { M: overrides.mutualData } } : {}),
      },
    },
  } as any;
}

describe('replication-processor handler — mutual soft-delete cascade', () => {
  it('MODIFY with a newly-set expiresAt (soft-delete) cascades a delete to every R2PK-matching replicated item, without doing the normal mutualData copy', async () => {
    const query = vi.fn().mockResolvedValue({
      Items: [
        { PK: { S: 'ENROLLMENT#abc' }, SK: { S: '#METADATA#' } },
      ],
    });
    const deleteItem = vi.fn().mockResolvedValue({});
    const updateItem = vi.fn().mockResolvedValue({});
    const { container } = buildContainer({ query, deleteItem, updateItem });

    const result = await handler(container)({
      Records: [buildMutualModifyRecord({ mutualId: 'mutual-1', expiresAt: '1234567890' })],
    });

    expect(result.batchItemFailures).toEqual([]);

    // Cascaded a real delete to the R2PK-matching (synthetic entity) item.
    expect(deleteItem).toHaveBeenCalledTimes(1);
    expect(deleteItem).toHaveBeenCalledWith(
      expect.objectContaining({
        Key: { PK: { S: 'ENROLLMENT#abc' }, SK: { S: '#METADATA#' } },
      }),
    );

    // Did NOT fall through to the normal copy-mutualData-onto-replicas update.
    expect(updateItem).not.toHaveBeenCalled();
  });

  it('MODIFY without expiresAt (an ordinary mutualData update) still does the normal copy, unaffected by the soft-delete branch', async () => {
    const query = vi.fn().mockResolvedValue({
      Items: [
        { PK: { S: 'ENROLLMENT#abc' }, SK: { S: '#METADATA#' }, updatedAt: { S: '2025-01-01T00:00:00.000Z' } },
      ],
    });
    const updateItem = vi.fn().mockResolvedValue({});
    const deleteItem = vi.fn().mockResolvedValue({});
    const { container } = buildContainer({ query, updateItem, deleteItem });

    const result = await handler(container)({
      Records: [
        buildMutualModifyRecord({
          mutualId: 'mutual-2',
          mutualData: { role: { S: 'student' } },
        }),
      ],
    });

    expect(result.batchItemFailures).toEqual([]);
    expect(updateItem).toHaveBeenCalledTimes(1);
    expect(deleteItem).not.toHaveBeenCalled();
  });
});
