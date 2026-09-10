import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createEntityConfig } from '../../../../base';
import type { Entity as EntityType } from '../../../../base';
import {
  StandardError,
  StandardErrorCode,
} from '../../../errors/standard-error';
import { UpsertEntityController } from '../upsert-entity.controller';

enum TestEntity {
  COMPETITION = 'competition',
  ORGANISATION = 'organisation',
}

// Built via the real createEntityConfig factory (not a hand-rolled mock) so
// this also exercises the factory→call-site wiring, matching
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

const EntityConfig: any = {
  [TestEntity.COMPETITION]: competitionConfig,
};

// Minimal duck-typed Hono context — createMiddleware's wrapped callback only
// ever touches req.header/req.param/req.json and c.status/c.json at runtime,
// so a hand-built object covering exactly that surface exercises the real
// controller code without needing a live Hono app + LocalStack table (the
// pattern data/__tests__/*Http.test.ts uses for full-stack HTTP coverage —
// out of scope for this focused regression test).
function fakeContext(entityId: string, body: object) {
  let statusCode = 200;
  return {
    req: {
      header: () => undefined,
      param: () => ({ entityType: TestEntity.COMPETITION, entityId }),
      json: async () => body,
    },
    status: (code: number) => {
      statusCode = code;
    },
    json: (data: unknown) => ({ status: statusCode, data }),
  } as any;
}

describe('UpsertEntityController — createMutualSchema on the insert case', () => {
  const buildController = (entityRepository: any) =>
    new UpsertEntityController(
      EntityConfig,
      entityRepository,
      vi.fn().mockResolvedValue(undefined),
    );

  it('rejects an insert (entity does not yet exist) missing a field required by createMutualSchema', async () => {
    const entityRepository = {
      getEntity: vi
        .fn()
        .mockRejectedValue(
          new StandardError(
            StandardErrorCode.ENTITY_IS_UNDEFINED,
            'Entity item empty',
          ),
        ),
      upsertEntity: vi.fn(),
    };
    const controller = buildController(entityRepository);

    const result = await controller.controller(
      fakeContext('comp-1', { name: 'Winter League' }), // no organisationIds
      async () => {},
    );

    expect(entityRepository.upsertEntity).not.toHaveBeenCalled();
    expect((result as any).status).toBe(400);
    expect((result as any).data.code).toBe('API_VALIDATION_ERROR');
  });

  it('accepts an insert that satisfies createMutualSchema and wires the mutual', async () => {
    const entityRepository = {
      getEntity: vi
        .fn()
        .mockRejectedValue(
          new StandardError(
            StandardErrorCode.ENTITY_IS_UNDEFINED,
            'Entity item empty',
          ),
        ),
      upsertEntity: vi.fn().mockResolvedValue({
        entityId: 'comp-1',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    };
    const controller = buildController(entityRepository);

    const result = await controller.controller(
      fakeContext('comp-1', {
        name: 'Winter League',
        organisationIds: ['org-1'],
      }),
      async () => {},
    );

    expect(entityRepository.upsertEntity).toHaveBeenCalled();
    expect((result as any).status).toBe(200);
  });

  it('does NOT require the createMutualSchema field when the entity already exists (this is an update, not an insert)', async () => {
    const entityRepository = {
      getEntity: vi.fn().mockResolvedValue({ entityId: 'comp-1' }),
      upsertEntity: vi.fn().mockResolvedValue({
        entityId: 'comp-1',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    };
    const controller = buildController(entityRepository);

    // No organisationIds — must succeed, matching mutualSchema's own
    // (partial) leniency for updates, same as every other update path.
    const result = await controller.controller(
      fakeContext('comp-1', { name: 'Winter League renamed' }),
      async () => {},
    );

    expect(entityRepository.upsertEntity).toHaveBeenCalled();
    expect((result as any).status).toBe(200);
  });

  it('rethrows an unexpected getEntity error rather than misclassifying it as an insert', async () => {
    const entityRepository = {
      getEntity: vi
        .fn()
        .mockRejectedValue(new Error('DynamoDB is unavailable')),
      upsertEntity: vi.fn(),
    };
    const controller = buildController(entityRepository);

    await expect(
      controller.controller(
        fakeContext('comp-1', { name: 'Winter League' }),
        async () => {},
      ),
    ).rejects.toThrow('DynamoDB is unavailable');

    expect(entityRepository.upsertEntity).not.toHaveBeenCalled();
  });
});
