import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createEntityConfig } from '../../../base';
import type { Entity as EntityType } from '../../../base';
import { EntityServiceLifeCycle } from '../entity-service-lifecycle';

enum TestEntity {
  COMPETITION = 'competition',
  ORGANISATION = 'organisation',
  LEGACY_ENTITY = 'legacy-entity',
  MULTI_MUTUAL_ENTITY = 'multi-mutual-entity',
  ROUTABLE = 'routable',
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

// Mirrors competition.ts's real shape: mutualSchema declares TWO mutual
// fields, but createMutualSchema (authored as `mutualSchema.required({...})`
// convention — here spelled out explicitly for clarity) only tightens ONE
// of them. Regression coverage for the bug where a plain `createMutualSchema
// || mutualSchema` fallback would drop routableIds entirely from create-time
// parsing, silently never wiring it even when supplied.
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
  [TestEntity.LEGACY_ENTITY]: legacyConfig,
  [TestEntity.MULTI_MUTUAL_ENTITY]: multiMutualConfig,
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

  it('merges createMutualSchema into mutualSchema rather than replacing it — a mutual field only mutualSchema declares survives on finalSchema', () => {
    // organisationIds required (via createMutualSchema), routableIds still
    // accepted (from mutualSchema) even though createMutualSchema never
    // mentions it.
    expect(() =>
      multiMutualConfig.finalSchema.parse({
        name: 'Winter League',
        organisationIds: ['org-1'],
        routableIds: ['routable-1'],
      }),
    ).not.toThrow();

    const parsed = multiMutualConfig.finalSchema.parse({
      name: 'Winter League',
      organisationIds: ['org-1'],
      routableIds: ['routable-1'],
    });
    expect(parsed).toMatchObject({ routableIds: ['routable-1'] });
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

  it('wires a mutual field that only mutualSchema declares, even though createMutualSchema (which is present and stricter about a different field) omits it entirely', async () => {
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
        entityType: TestEntity.MULTI_MUTUAL_ENTITY,
        entityId: 'multi-1',
        data: {},
        updatedAt: '2026-01-01T00:00:00.000Z',
      } as any,
      {
        name: 'Winter League',
        organisationIds: ['org-1'],
        routableIds: ['routable-1'],
      },
    );

    // Both fields must reach the wiring event — a plain `createMutualSchema
    // || mutualSchema` fallback would parse only against createMutualSchema
    // (which doesn't declare routableIds at all), stripping it before this
    // point and silently never wiring it.
    expect(eventUtils.publishCreateMutualsEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        mutualPayload: expect.objectContaining({
          organisationIds: ['org-1'],
          routableIds: ['routable-1'],
        }),
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
