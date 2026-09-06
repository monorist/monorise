import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createEntityConfig } from '../../../base';
import type { Entity as EntityType } from '../../../base';
import { EntityServiceLifeCycle } from '../entity-service-lifecycle';

enum TestEntity {
  COMPETITION = 'competition',
  ORGANISATION = 'organisation',
  LEGACY_ENTITY = 'legacy-entity',
}

// Built via the real createEntityConfig factory (not a hand-rolled mock) so
// this also exercises makeSchema's finalSchema construction — confirming
// createMutualSchema is honored there too, not just in the lifecycle hook.
const competitionConfig = createEntityConfig({
  name: TestEntity.COMPETITION,
  displayName: 'Competition',
  baseSchema: z.object({ name: z.string(), organisationId: z.string() }).partial(),
  createSchema: z.object({ name: z.string(), organisationId: z.string() }),
  mutual: {
    mutualSchema: z.object({ organisationIds: z.string().array() }).partial(),
    createMutualSchema: z.object({ organisationIds: z.string().array() }),
    mutualFields: {
      organisationIds: { entityType: TestEntity.ORGANISATION as unknown as EntityType },
    },
  },
});

const legacyConfig = createEntityConfig({
  name: TestEntity.LEGACY_ENTITY,
  displayName: 'Legacy Entity',
  baseSchema: z.object({ name: z.string() }).partial(),
  mutual: {
    mutualSchema: z.object({ organisationIds: z.string().array() }).partial(),
    mutualFields: {
      organisationIds: { entityType: TestEntity.ORGANISATION as unknown as EntityType },
    },
  },
});

const EntityConfig: any = {
  [TestEntity.COMPETITION]: competitionConfig,
  [TestEntity.LEGACY_ENTITY]: legacyConfig,
};

describe('createEntityConfig — finalSchema respects createMutualSchema (create-only path)', () => {
  it('requires the mutual field on finalSchema when createMutualSchema is defined', () => {
    expect(() =>
      competitionConfig.finalSchema.parse({ name: 'Winter League', organisationId: 'org-1' }),
    ).toThrow();

    expect(() =>
      competitionConfig.finalSchema.parse({
        name: 'Winter League',
        organisationId: 'org-1',
        organisationIds: ['org-1'],
      }),
    ).not.toThrow();
  });

  it('leaves finalSchema permissive when no createMutualSchema is defined', () => {
    expect(() =>
      legacyConfig.finalSchema.parse({ name: 'no mutual data' }),
    ).not.toThrow();
  });
});

describe('EntityServiceLifeCycle.afterCreateEntityHook — createMutualSchema', () => {
  it('rejects a create payload missing a field required by createMutualSchema, even though mutualSchema itself is partial', async () => {
    const publishEvent = vi.fn();
    const eventUtils = { publishCreateMutualsEvent: vi.fn() } as any;
    const lifecycle = new EntityServiceLifeCycle(
      EntityConfig,
      publishEvent,
      eventUtils,
    );

    await expect(
      lifecycle.afterCreateEntityHook(
        {
          entityType: TestEntity.COMPETITION,
          entityId: 'comp-1',
          data: {},
          updatedAt: '2026-01-01T00:00:00.000Z',
        } as any,
        { name: 'Winter League' }, // no organisationIds
      ),
    ).rejects.toThrow();

    expect(eventUtils.publishCreateMutualsEvent).not.toHaveBeenCalled();
  });

  it('accepts and wires a create payload that satisfies createMutualSchema', async () => {
    const publishEvent = vi.fn().mockResolvedValue(undefined);
    const eventUtils = {
      publishCreateMutualsEvent: vi.fn().mockResolvedValue(undefined),
    } as any;
    const lifecycle = new EntityServiceLifeCycle(
      EntityConfig,
      publishEvent,
      eventUtils,
    );

    await lifecycle.afterCreateEntityHook(
      {
        entityType: TestEntity.COMPETITION,
        entityId: 'comp-1',
        data: {},
        updatedAt: '2026-01-01T00:00:00.000Z',
      } as any,
      { name: 'Winter League', organisationIds: ['org-1'] },
    );

    expect(eventUtils.publishCreateMutualsEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        mutualPayload: expect.objectContaining({ organisationIds: ['org-1'] }),
      }),
    );
  });

  it('falls back to the ordinary (partial) mutualSchema when createMutualSchema is not defined — existing configs are unaffected', async () => {
    const publishEvent = vi.fn().mockResolvedValue(undefined);
    const eventUtils = {
      publishCreateMutualsEvent: vi.fn().mockResolvedValue(undefined),
    } as any;
    const lifecycle = new EntityServiceLifeCycle(
      EntityConfig,
      publishEvent,
      eventUtils,
    );

    // No organisationIds at all — must NOT throw, matching today's behavior.
    await expect(
      lifecycle.afterCreateEntityHook(
        {
          entityType: TestEntity.LEGACY_ENTITY,
          entityId: 'legacy-1',
          data: {},
          updatedAt: '2026-01-01T00:00:00.000Z',
        } as any,
        { name: 'no mutual data' },
      ),
    ).resolves.toBeUndefined();
  });
});
