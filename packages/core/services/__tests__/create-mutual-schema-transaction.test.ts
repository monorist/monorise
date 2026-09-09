import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createEntityConfig } from '../../../base';
import type { Entity as EntityType } from '../../../base';
import { EVENT } from '../../types/event';
import { TransactionService } from '../transaction.service';

enum TestEntity {
  COMPETITION = 'competition',
  ORGANISATION = 'organisation',
  MULTI_MUTUAL_ENTITY = 'multi-mutual-entity',
  ROUTABLE = 'routable',
}

// TransactionService.collectCreateEvents is private — same access pattern
// mutual-data-schema.test.ts already uses for MutualService's own private
// helpers in this package.
describe('TransactionService.collectCreateEvents — createMutualSchema', () => {
  // Built via the real createEntityConfig factory (not a hand-rolled mock)
  // so this also exercises the factory→call-site wiring, matching
  // create-mutual-schema.test.ts's own pattern.
  const competitionConfig = createEntityConfig({
    name: TestEntity.COMPETITION,
    displayName: 'Competition',
    baseSchema: z.object({ name: z.string() }).partial(),
    createSchema: z.object({ name: z.string() }),
    mutual: {
      mutualSchema: z.object({ organisationIds: z.string().array() }).partial(),
      createMutualSchema: z.object({ organisationIds: z.string().array() }),
      mutualFields: {
        organisationIds: { entityType: TestEntity.ORGANISATION as unknown as EntityType },
      },
    },
  });
  // mutualSchema declares TWO fields; createMutualSchema only tightens
  // one — regression coverage for the drop-on-merge bug (see
  // create-mutual-schema.test.ts's own multiMutualConfig for the full
  // rationale).
  const multiMutualConfig = createEntityConfig({
    name: TestEntity.MULTI_MUTUAL_ENTITY,
    displayName: 'Multi Mutual Entity',
    baseSchema: z.object({ name: z.string() }).partial(),
    createSchema: z.object({ name: z.string() }),
    mutual: {
      mutualSchema: z
        .object({
          organisationIds: z.string().array(),
          routableIds: z.string().array(),
        })
        .partial(),
      createMutualSchema: z.object({ organisationIds: z.string().array() }),
      mutualFields: {
        organisationIds: { entityType: TestEntity.ORGANISATION as unknown as EntityType },
        routableIds: { entityType: TestEntity.ROUTABLE as unknown as EntityType },
      },
    },
  });

  const EntityConfig: any = {
    [TestEntity.COMPETITION]: competitionConfig,
    [TestEntity.MULTI_MUTUAL_ENTITY]: multiMutualConfig,
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

  it('emits mutual-create events for a field mutualSchema declares but createMutualSchema omits entirely', () => {
    const service = buildService();
    const collectCreateEvents = (service as any).collectCreateEvents.bind(
      service,
    );

    const events = collectCreateEvents(
      {
        entityType: TestEntity.MULTI_MUTUAL_ENTITY,
        entityId: 'multi-1',
        data: {},
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        name: 'Winter League',
        organisationIds: ['org-1'],
        routableIds: ['routable-1'],
      },
    );

    // A plain `createMutualSchema || mutualSchema` fallback would parse
    // only against createMutualSchema here (which never declares
    // routableIds), stripping it before this point — so no event for it
    // would ever be produced.
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: EVENT.CORE.ENTITY_MUTUAL_TO_CREATE,
          payload: expect.objectContaining({ mutualIds: ['org-1'] }),
        }),
        expect.objectContaining({
          event: EVENT.CORE.ENTITY_MUTUAL_TO_CREATE,
          payload: expect.objectContaining({ mutualIds: ['routable-1'] }),
        }),
      ]),
    );
  });
});
