import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  createEntityConfig,
  createMutualConfig,
} from '../../../base';
import type { Entity as EntityType } from '../../../base';
import { EVENT } from '../../types/event';
import { MutualService, resolveAsEntityOptions } from '../mutual.service';

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

describe('resolveAsEntityOptions', () => {
  it('resolves asEntity/ensureEntityStrongConsistentWrite from config when no call-site options are given', () => {
    const result = resolveAsEntityOptions({
      asEntity: enrollmentEntityConfig,
      ensureEntityStrongConsistentWrite: true,
    });

    expect(result).toEqual({
      asEntity: TestEntity.ENROLLMENT,
      ensureEntityStrongConsistentWrite: true,
    });
  });

  it('call-site asEntity overrides config-level asEntity', () => {
    const result = resolveAsEntityOptions(
      { asEntity: enrollmentEntityConfig, ensureEntityStrongConsistentWrite: true },
      { asEntity: TestEntity.BADGE as unknown as EntityType },
    );

    expect(result.asEntity).toBe(TestEntity.BADGE);
  });

  it('call-site ensureEntityStrongConsistentWrite overrides config-level value', () => {
    const result = resolveAsEntityOptions(
      { asEntity: enrollmentEntityConfig, ensureEntityStrongConsistentWrite: true },
      { ensureEntityStrongConsistentWrite: false },
    );

    expect(result).toEqual({
      asEntity: TestEntity.ENROLLMENT,
      ensureEntityStrongConsistentWrite: false,
    });
  });

  it('works from call-site asEntity alone (no config) and defaults ensureEntityStrongConsistentWrite to false', () => {
    const result = resolveAsEntityOptions(undefined, {
      asEntity: TestEntity.BADGE as unknown as EntityType,
    });

    expect(result).toEqual({
      asEntity: TestEntity.BADGE,
      ensureEntityStrongConsistentWrite: false,
    });
  });

  it('returns undefined asEntity when neither config nor call-site set it', () => {
    expect(resolveAsEntityOptions(undefined, {})).toEqual({
      asEntity: undefined,
      ensureEntityStrongConsistentWrite: false,
    });
  });

  it('defaults ensureEntityStrongConsistentWrite to false when config sets asEntity but not ensureEntityStrongConsistentWrite', () => {
    const result = resolveAsEntityOptions({ asEntity: enrollmentEntityConfig });

    expect(result).toEqual({
      asEntity: TestEntity.ENROLLMENT,
      ensureEntityStrongConsistentWrite: false,
    });
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
    ensureEntityStrongConsistentWrite: true,
  });

  const mutualWithAsEntityAsync = createMutualConfig({
    entities: [
      TestEntity.STUDENT as unknown as EntityType,
      TestEntity.COURSE as unknown as EntityType,
    ],
    asEntity: enrollmentEntityConfig,
    // ensureEntityStrongConsistentWrite omitted — defaults to async CREATE_ENTITY event path.
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

  it('existing behavior unchanged: imperative call-site asEntity + ensureEntityStrongConsistentWrite:true (no config-level asEntity) creates the entity synchronously', async () => {
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
        ensureEntityStrongConsistentWrite: true,
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

  it('existing behavior unchanged: imperative call-site asEntity without ensureEntityStrongConsistentWrite publishes the async CREATE_ENTITY event instead', async () => {
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
      options: { asEntity: TestEntity.ENROLLMENT as unknown as EntityType },
    });

    expect(deps.entityRepository.createEntityTransactItems).not.toHaveBeenCalled();
    expect(deps.entityServiceLifeCycle.afterCreateEntityHook).not.toHaveBeenCalled();
    const calls = createEntityEventCalls(deps.publishEvent);
    expect(calls).toHaveLength(1);
    expect(calls[0][0].payload).toMatchObject({ entityType: TestEntity.ENROLLMENT });
  });

  it('config-level asEntity (no call-site options) resolves from createMutualConfig and creates the entity synchronously per the config', async () => {
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

  it('config-level asEntity with ensureEntityStrongConsistentWrite omitted (async default) publishes CREATE_ENTITY instead of calling afterCreateEntityHook', async () => {
    const EntityConfig = buildEntityConfig(mutualWithAsEntityAsync);
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
    const calls = createEntityEventCalls(deps.publishEvent);
    expect(calls).toHaveLength(1);
    expect(calls[0][0].payload).toMatchObject({ entityType: TestEntity.ENROLLMENT });
  });

  it('precedence: call-site options.asEntity overrides a config-level asEntity, but does NOT inherit the config-level ensureEntityStrongConsistentWrite it did not ask for', async () => {
    // `mutualWithAsEntity`'s `ensureEntityStrongConsistentWrite: true` belongs to ITS OWN
    // `asEntity` (ENROLLMENT) — a call site overriding `asEntity` to a different entity type
    // (BADGE) has no config-level consistency setting of its own to inherit, so this must default
    // to `false` (async) unless the call site also explicitly asks for strong consistency (see
    // the next test). Prior to fixing this, the override would silently inherit ENROLLMENT's
    // `true` for an entity type it has nothing to do with.
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

    expect(deps.entityServiceLifeCycle.afterCreateEntityHook).not.toHaveBeenCalled();
    const calls = createEntityEventCalls(deps.publishEvent);
    expect(calls).toHaveLength(1);
    expect(calls[0][0].payload).toMatchObject({ entityType: TestEntity.BADGE });
  });

  it('precedence: call-site options.asEntity + explicit ensureEntityStrongConsistentWrite together override the config fully', async () => {
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
      options: {
        asEntity: TestEntity.BADGE as unknown as EntityType,
        ensureEntityStrongConsistentWrite: true,
      },
    });

    expect(
      deps.entityServiceLifeCycle.afterCreateEntityHook.mock.calls[0][0].entityType,
    ).toBe(TestEntity.BADGE);
  });
});
