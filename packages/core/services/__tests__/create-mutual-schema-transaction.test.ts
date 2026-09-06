import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { TransactionService } from '../transaction.service';
import { EVENT } from '../../types/event';

enum TestEntity {
  COMPETITION = 'competition',
  ORGANISATION = 'organisation',
}

// TransactionService.collectCreateEvents is private — same access pattern
// mutual-data-schema.test.ts already uses for MutualService's own private
// helpers in this package.
describe('TransactionService.collectCreateEvents — createMutualSchema', () => {
  const EntityConfig: any = {
    [TestEntity.COMPETITION]: {
      mutual: {
        mutualSchema: z.object({ organisationIds: z.string().array() }).partial(),
        createMutualSchema: z.object({ organisationIds: z.string().array() }),
        mutualFields: {
          organisationIds: { entityType: TestEntity.ORGANISATION },
        },
      },
    },
  };

  const buildService = () =>
    new TransactionService(
      EntityConfig,
      [],
      {} as any, // entityRepository
      {} as any, // dynamodbClient
      vi.fn() as any, // publishEvent
      {} as any, // entityServiceLifeCycle
      {} as any, // eventUtils
    );

  it('throws when a transactional create payload is missing a field required by createMutualSchema', () => {
    const service = buildService();
    const collectCreateEvents = (service as any).collectCreateEvents.bind(
      service,
    );

    expect(() =>
      collectCreateEvents(
        {
          entityType: TestEntity.COMPETITION,
          entityId: 'comp-1',
          data: {},
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        { name: 'Winter League' }, // no organisationIds
      ),
    ).toThrow();
  });

  it('succeeds and emits a mutual-create event when the payload satisfies createMutualSchema', () => {
    const service = buildService();
    const collectCreateEvents = (service as any).collectCreateEvents.bind(
      service,
    );

    const events = collectCreateEvents(
      {
        entityType: TestEntity.COMPETITION,
        entityId: 'comp-1',
        data: {},
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      { name: 'Winter League', organisationIds: ['org-1'] },
    );

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: EVENT.CORE.ENTITY_MUTUAL_TO_CREATE,
          payload: expect.objectContaining({ mutualIds: ['org-1'] }),
        }),
      ]),
    );
  });
});
