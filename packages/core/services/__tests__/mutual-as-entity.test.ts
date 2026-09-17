import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  createEntityConfig,
  createMutualConfig,
} from '../../../base';
import type { Entity as EntityType } from '../../../base';
import { EVENT } from '../../types/event';
import { MutualService, resolveAsEntity } from '../mutual.service';

enum TestEntity {
  STUDENT = 'student',
  COURSE = 'course',
  ENROLLMENT = 'enrollment',
  BADGE = 'badge',
}

// The `asEntity` target(s): real createEntityConfig(...) results, since MutualConfig.asEntity
// takes the config object directly (not a bare Entity value).
const enrollmentEntityConfig = createEntityConfig({
  name: TestEntity.ENROLLMENT,
  displayName: 'Enrollment',
  baseSchema: z.object({ role: z.string(), enrolledAt: z.string() }).partial(),
  createSchema: z.object({ role: z.string(), enrolledAt: z.string() }),
});

const badgeEntityConfig = createEntityConfig({
  name: TestEntity.BADGE,
  displayName: 'Badge',
  baseSchema: z.object({ role: z.string(), enrolledAt: z.string() }).partial(),
  createSchema: z.object({ role: z.string(), enrolledAt: z.string() }),
});

// An `asEntity` target that declares its OWN further mutualFields, with the mutual field made
// REQUIRED at create time via `createMutualSchema` — the strictest case for the storage
// narrowing: `badgeIds` is required by the target entity's own create-path validation, yet must
// never be persisted as this mutual's `mutualData` or the synthetic entity's `data`.
const enrollmentWithRequiredBadgesConfig = createEntityConfig({
  name: TestEntity.ENROLLMENT,
  displayName: 'Enrollment',
  baseSchema: z.object({ role: z.string(), enrolledAt: z.string() }).partial(),
  createSchema: z.object({ role: z.string(), enrolledAt: z.string() }),
  mutual: {
    mutualSchema: z.object({ badgeIds: z.string().array() }).partial(),
    createMutualSchema: z.object({ badgeIds: z.string().array() }),
    mutualFields: {
      badgeIds: {
        entityType: TestEntity.BADGE as unknown as EntityType,
        mutual: createMutualConfig({
          entities: [
            TestEntity.ENROLLMENT as unknown as EntityType,
            TestEntity.BADGE as unknown as EntityType,
          ],
          mutualDataSchema: z.object({}),
        }),
      },
    },
  },
});

describe('createMutualConfig — asEntity', () => {
  it('throws synchronously when both asEntity and mutualDataSchema are provided', () => {
    expect(() =>
      createMutualConfig({
        entities: [
          TestEntity.STUDENT as unknown as EntityType,
          TestEntity.COURSE as unknown as EntityType,
        ],
        asEntity: enrollmentEntityConfig,
        mutualDataSchema: z.object({ role: z.string() }),
      }),
    ).toThrow(/mutually exclusive/);
  });

  it('derives mutualDataSchema from asEntity.finalSchema when asEntity is set', () => {
    const mutual = createMutualConfig({
      entities: [
        TestEntity.STUDENT as unknown as EntityType,
        TestEntity.COURSE as unknown as EntityType,
      ],
      asEntity: enrollmentEntityConfig,
    });

    expect(mutual.mutualDataSchema).toBe(enrollmentEntityConfig.finalSchema);
  });

  it('leaves mutualDataSchema untouched (identity behavior) when asEntity is not set', () => {
    const schema = z.object({ role: z.string() });
    const mutual = createMutualConfig({
      entities: [
        TestEntity.STUDENT as unknown as EntityType,
        TestEntity.COURSE as unknown as EntityType,
      ],
      mutualDataSchema: schema,
    });

    expect(mutual.mutualDataSchema).toBe(schema);
    expect(mutual.asEntity).toBeUndefined();
  });
});

describe('resolveAsEntity', () => {
  it('resolves asEntity from config when no call-site options are given', () => {
    expect(resolveAsEntity({ asEntity: enrollmentEntityConfig })).toBe(
      TestEntity.ENROLLMENT,
    );
  });

  it('call-site asEntity overrides config-level asEntity', () => {
    const result = resolveAsEntity(
      { asEntity: enrollmentEntityConfig },
      { asEntity: TestEntity.BADGE as unknown as EntityType },
    );

    expect(result).toBe(TestEntity.BADGE);
  });

  it('works from call-site asEntity alone (no config)', () => {
    const result = resolveAsEntity(undefined, {
      asEntity: TestEntity.BADGE as unknown as EntityType,
    });

    expect(result).toBe(TestEntity.BADGE);
  });

  it('returns undefined when neither config nor call-site set it', () => {
    expect(resolveAsEntity(undefined, {})).toBeUndefined();
  });
});

describe('MutualService.createMutual — asEntity integration', () => {
  const mutualWithoutAsEntity = createMutualConfig({
    entities: [
      TestEntity.STUDENT as unknown as EntityType,
      TestEntity.COURSE as unknown as EntityType,
    ],
    mutualDataSchema: z.object({ role: z.string(), enrolledAt: z.string() }),
  });

  const mutualWithAsEntity = createMutualConfig({
    entities: [
      TestEntity.STUDENT as unknown as EntityType,
      TestEntity.COURSE as unknown as EntityType,
    ],
    asEntity: enrollmentEntityConfig,
  });

  const buildEntityConfig = (mutual: ReturnType<typeof createMutualConfig>) =>
    ({
      [TestEntity.STUDENT]: createEntityConfig({
        name: TestEntity.STUDENT,
        displayName: 'Student',
        baseSchema: z.object({ name: z.string() }).partial(),
        mutual: {
          mutualSchema: z.object({ courseIds: z.string().array() }).partial(),
          mutualFields: {
            courseIds: {
              entityType: TestEntity.COURSE as unknown as EntityType,
              mutual,
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
      [TestEntity.BADGE]: badgeEntityConfig,
    }) as any;

  const buildDeps = () => {
    const entityRepository = {
      getEntity: vi.fn().mockResolvedValue({ data: {} }),
      createEntityTransactItems: vi
        .fn()
        .mockReturnValue([{ Put: { TableName: 'test', Item: {} } }]),
    };
    const mutualRepository = {
      checkMutualExist: vi.fn().mockResolvedValue(undefined),
      createMutualTransactItems: vi.fn().mockReturnValue([]),
    };
    const ddbUtils = { executeTransactWrite: vi.fn().mockResolvedValue(undefined) };
    const publishEvent = vi.fn().mockResolvedValue(undefined);
    const entityServiceLifeCycle = {
      afterCreateEntityHook: vi.fn().mockResolvedValue(undefined),
    };
    return {
      entityRepository,
      mutualRepository,
      ddbUtils,
      publishEvent,
      entityServiceLifeCycle,
    };
  };

  const createEntityEventCalls = (publishEvent: ReturnType<typeof vi.fn>) =>
    publishEvent.mock.calls.filter(
      ([arg]) => arg.event?.DetailType === EVENT.CORE.CREATE_ENTITY.DetailType,
    );

  it('regression: a mutual config without asEntity never creates a synthetic entity', async () => {
    const EntityConfig = buildEntityConfig(mutualWithoutAsEntity);
    const deps = buildDeps();
    const service = new MutualService(
      EntityConfig,
      deps.entityRepository as any,
      deps.mutualRepository as any,
      deps.publishEvent as any,
      deps.ddbUtils as any,
      deps.entityServiceLifeCycle as any,
    );

    await service.createMutual({
      byEntityType: TestEntity.STUDENT as unknown as EntityType,
      byEntityId: 'student-1',
      entityType: TestEntity.COURSE as unknown as EntityType,
      entityId: 'course-1',
      mutualPayload: { role: 'student', enrolledAt: '2026-01-01' },
    });

    expect(deps.entityRepository.createEntityTransactItems).not.toHaveBeenCalled();
    expect(deps.entityServiceLifeCycle.afterCreateEntityHook).not.toHaveBeenCalled();
    expect(createEntityEventCalls(deps.publishEvent)).toHaveLength(0);
  });

  it('imperative call-site asEntity (no config-level asEntity) creates the entity in the same transaction', async () => {
    const EntityConfig = buildEntityConfig(mutualWithoutAsEntity);
    const deps = buildDeps();
    const service = new MutualService(
      EntityConfig,
      deps.entityRepository as any,
      deps.mutualRepository as any,
      deps.publishEvent as any,
      deps.ddbUtils as any,
      deps.entityServiceLifeCycle as any,
    );

    await service.createMutual({
      byEntityType: TestEntity.STUDENT as unknown as EntityType,
      byEntityId: 'student-1',
      entityType: TestEntity.COURSE as unknown as EntityType,
      entityId: 'course-1',
      mutualPayload: { role: 'student', enrolledAt: '2026-01-01' },
      options: {
        asEntity: TestEntity.ENROLLMENT as unknown as EntityType,
      },
    });

    expect(deps.entityRepository.createEntityTransactItems).toHaveBeenCalledTimes(1);
    expect(deps.ddbUtils.executeTransactWrite).toHaveBeenCalledTimes(1);
    expect(deps.entityServiceLifeCycle.afterCreateEntityHook).toHaveBeenCalledTimes(1);
    expect(
      deps.entityServiceLifeCycle.afterCreateEntityHook.mock.calls[0][0].entityType,
    ).toBe(TestEntity.ENROLLMENT);
    expect(createEntityEventCalls(deps.publishEvent)).toHaveLength(0);
  });

  it('config-level asEntity (no call-site options) resolves from createMutualConfig and creates the entity in the same transaction', async () => {
    const EntityConfig = buildEntityConfig(mutualWithAsEntity);
    const deps = buildDeps();
    const service = new MutualService(
      EntityConfig,
      deps.entityRepository as any,
      deps.mutualRepository as any,
      deps.publishEvent as any,
      deps.ddbUtils as any,
      deps.entityServiceLifeCycle as any,
    );

    await service.createMutual({
      byEntityType: TestEntity.STUDENT as unknown as EntityType,
      byEntityId: 'student-1',
      entityType: TestEntity.COURSE as unknown as EntityType,
      entityId: 'course-1',
      mutualPayload: { role: 'student', enrolledAt: '2026-01-01' },
    });

    expect(deps.entityRepository.createEntityTransactItems).toHaveBeenCalledTimes(1);
    expect(deps.entityServiceLifeCycle.afterCreateEntityHook).toHaveBeenCalledTimes(1);
    expect(
      deps.entityServiceLifeCycle.afterCreateEntityHook.mock.calls[0][0].entityType,
    ).toBe(TestEntity.ENROLLMENT);
    expect(createEntityEventCalls(deps.publishEvent)).toHaveLength(0);
  });

  it('precedence: call-site options.asEntity overrides a config-level asEntity', async () => {
    const EntityConfig = buildEntityConfig(mutualWithAsEntity);
    const deps = buildDeps();
    const service = new MutualService(
      EntityConfig,
      deps.entityRepository as any,
      deps.mutualRepository as any,
      deps.publishEvent as any,
      deps.ddbUtils as any,
      deps.entityServiceLifeCycle as any,
    );

    await service.createMutual({
      byEntityType: TestEntity.STUDENT as unknown as EntityType,
      byEntityId: 'student-1',
      entityType: TestEntity.COURSE as unknown as EntityType,
      entityId: 'course-1',
      mutualPayload: { role: 'student', enrolledAt: '2026-01-01' },
      options: { asEntity: TestEntity.BADGE as unknown as EntityType },
    });

    expect(
      deps.entityServiceLifeCycle.afterCreateEntityHook.mock.calls[0][0].entityType,
    ).toBe(TestEntity.BADGE);
    expect(createEntityEventCalls(deps.publishEvent)).toHaveLength(0);
  });

  it("storage stays narrowed while afterCreateEntityHook receives the target entity's own mutual-field keys", async () => {
    const mutualWithRequiredFurtherField = createMutualConfig({
      entities: [
        TestEntity.STUDENT as unknown as EntityType,
        TestEntity.COURSE as unknown as EntityType,
      ],
      asEntity: enrollmentWithRequiredBadgesConfig,
    });

    const EntityConfig = buildEntityConfig(mutualWithRequiredFurtherField);
    EntityConfig[TestEntity.ENROLLMENT] = enrollmentWithRequiredBadgesConfig;
    const deps = buildDeps();
    const service = new MutualService(
      EntityConfig,
      deps.entityRepository as any,
      deps.mutualRepository as any,
      deps.publishEvent as any,
      deps.ddbUtils as any,
      deps.entityServiceLifeCycle as any,
    );

    const { mutual } = await service.createMutual({
      byEntityType: TestEntity.STUDENT as unknown as EntityType,
      byEntityId: 'student-1',
      entityType: TestEntity.COURSE as unknown as EntityType,
      entityId: 'course-1',
      mutualPayload: {
        role: 'student',
        enrolledAt: '2026-01-01',
        badgeIds: ['badge-1'],
      },
    });

    // Storage stays narrowed — ENROLLMENT's own relationship ids must not be baked into the
    // mutual's stored data, where they'd go stale the moment those relationships change.
    expect(mutual.mutualData).toEqual({
      role: 'student',
      enrolledAt: '2026-01-01',
    });
    expect(mutual.mutualData).not.toHaveProperty('badgeIds');

    const syntheticEntity =
      deps.entityRepository.createEntityTransactItems.mock.calls[0][0];
    expect(syntheticEntity.data).toEqual({
      role: 'student',
      enrolledAt: '2026-01-01',
    });

    // ...but the hook does not get narrowed: it parses what it's given with
    // `effectiveMutualSchema` to wire ENROLLMENT's own mutuals, so it needs `badgeIds`.
    const [, hookPayload] =
      deps.entityServiceLifeCycle.afterCreateEntityHook.mock.calls[0];
    expect(hookPayload).toMatchObject({
      role: 'student',
      enrolledAt: '2026-01-01',
      badgeIds: ['badge-1'],
    });
  });
});
