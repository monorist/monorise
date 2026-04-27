import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createEntityConfig,
  createMutualConfig,
} from '../../../base';
import type { Entity as EntityType } from '../../../base';
import { MutualService } from '../mutual.service';

enum TestEntity {
  STUDENT = 'student',
  COURSE = 'course',
  TAG = 'tag',
}

const enrollmentMutual = createMutualConfig({
  entities: [
    TestEntity.STUDENT as unknown as EntityType,
    TestEntity.COURSE as unknown as EntityType,
  ],
  mutualDataSchema: z.object({
    role: z.enum(['student', 'auditor']),
    enrolledAt: z.string(),
  }),
});

const mockEntityConfig = {
  [TestEntity.STUDENT]: createEntityConfig({
    name: TestEntity.STUDENT,
    displayName: 'Student',
    baseSchema: z.object({ name: z.string() }).partial(),
    mutual: {
      mutualSchema: z
        .object({
          courseIds: z.string().array(),
        })
        .partial(),
      mutualFields: {
        courseIds: {
          entityType: TestEntity.COURSE as unknown as EntityType,
          mutual: enrollmentMutual,
        },
      },
    },
  }),
  [TestEntity.COURSE]: createEntityConfig({
    name: TestEntity.COURSE,
    displayName: 'Course',
    baseSchema: z.object({ title: z.string() }).partial(),
    mutual: {
      mutualSchema: z
        .object({
          studentIds: z.string().array(),
        })
        .partial(),
      mutualFields: {
        studentIds: {
          entityType: TestEntity.STUDENT as unknown as EntityType,
          mutual: enrollmentMutual,
        },
      },
    },
  }),
  // Entity without mutualDataSchema
  [TestEntity.TAG]: createEntityConfig({
    name: TestEntity.TAG,
    displayName: 'Tag',
    baseSchema: z.object({ label: z.string() }).partial(),
  }),
} as any;

describe('createMutualConfig', () => {
  it('should create a mutual config with schema', () => {
    expect(enrollmentMutual.entities).toEqual([
      TestEntity.STUDENT,
      TestEntity.COURSE,
    ]);
    expect(enrollmentMutual.mutualDataSchema).toBeDefined();
  });

  it('should validate valid data', () => {
    const result = enrollmentMutual.mutualDataSchema.parse({
      role: 'student',
      enrolledAt: '2026-01-01',
    });
    expect(result).toEqual({ role: 'student', enrolledAt: '2026-01-01' });
  });

  it('should reject invalid data', () => {
    expect(() =>
      enrollmentMutual.mutualDataSchema.parse({
        role: 'invalid-role',
        enrolledAt: '2026-01-01',
      }),
    ).toThrow();
  });
});

describe('MutualService.getMutualDataSchema', () => {
  // Access private method via prototype for testing
  const service = new MutualService(
    mockEntityConfig,
    {} as any, // entityRepository
    {} as any, // mutualRepository
    {} as any, // publishEvent
    {} as any, // ddbUtils
    {} as any, // entityServiceLifeCycle
  );

  // Use bind trick to access private method
  const getMutualDataSchema = (service as any).getMutualDataSchema.bind(
    service,
  );

  it('should resolve schema for student -> course', () => {
    const schema = getMutualDataSchema(TestEntity.STUDENT, TestEntity.COURSE);
    expect(schema).toBeDefined();
    expect(schema).toBe(enrollmentMutual.mutualDataSchema);
  });

  it('should resolve schema for course -> student (reverse direction)', () => {
    const schema = getMutualDataSchema(TestEntity.COURSE, TestEntity.STUDENT);
    expect(schema).toBeDefined();
    expect(schema).toBe(enrollmentMutual.mutualDataSchema);
  });

  it('should return undefined for entity without mutual config', () => {
    const schema = getMutualDataSchema(TestEntity.TAG, TestEntity.STUDENT);
    expect(schema).toBeUndefined();
  });

  it('should return undefined for entity pair without mutualDataSchema', () => {
    // TAG has no mutual config at all
    const schema = getMutualDataSchema(TestEntity.STUDENT, TestEntity.TAG);
    expect(schema).toBeUndefined();
  });
});

describe('MutualService schema validation integration', () => {
  it('should validate mutualPayload in createMutual when schema exists', async () => {
    const mockEntityRepo = {
      getEntity: async () => ({ data: {} }),
    };
    const mockMutualRepo = {
      checkMutualExist: async () => {},
      createMutualTransactItems: () => [],
    };
    const mockDdbUtils = {
      executeTransactWrite: async () => {},
    };
    const mockPublishEvent = async () => {};
    const mockLifecycle = {};

    const service = new MutualService(
      mockEntityConfig,
      mockEntityRepo as any,
      mockMutualRepo as any,
      mockPublishEvent as any,
      mockDdbUtils as any,
      mockLifecycle as any,
    );

    // Invalid payload should throw ZodError
    await expect(
      service.createMutual({
        byEntityType: TestEntity.STUDENT as unknown as EntityType,
        byEntityId: 'student-1',
        entityType: TestEntity.COURSE as unknown as EntityType,
        entityId: 'course-1',
        mutualPayload: { role: 'invalid-role', enrolledAt: '2026-01-01' },
      }),
    ).rejects.toThrow();
  });

  it('should accept valid mutualPayload in createMutual', async () => {
    const mockEntityRepo = {
      getEntity: async () => ({ data: {} }),
    };
    const mockMutualRepo = {
      checkMutualExist: async () => {},
      createMutualTransactItems: () => [],
    };
    const mockDdbUtils = {
      executeTransactWrite: async () => {},
    };
    const mockPublishEvent = async () => {};
    const mockLifecycle = {};

    const service = new MutualService(
      mockEntityConfig,
      mockEntityRepo as any,
      mockMutualRepo as any,
      mockPublishEvent as any,
      mockDdbUtils as any,
      mockLifecycle as any,
    );

    // Valid payload should not throw
    await expect(
      service.createMutual({
        byEntityType: TestEntity.STUDENT as unknown as EntityType,
        byEntityId: 'student-1',
        entityType: TestEntity.COURSE as unknown as EntityType,
        entityId: 'course-1',
        mutualPayload: { role: 'student', enrolledAt: '2026-01-01' },
      }),
    ).resolves.toBeDefined();
  });

  it('should reject invalid mutualPayload in createMutual with reversed entity pair', async () => {
    const mockEntityRepo = {
      getEntity: async () => ({ data: {} }),
    };
    const mockMutualRepo = {
      checkMutualExist: async () => {},
      createMutualTransactItems: () => [],
    };
    const mockDdbUtils = {
      executeTransactWrite: async () => {},
    };
    const mockPublishEvent = async () => {};
    const mockLifecycle = {};

    const service = new MutualService(
      mockEntityConfig,
      mockEntityRepo as any,
      mockMutualRepo as any,
      mockPublishEvent as any,
      mockDdbUtils as any,
      mockLifecycle as any,
    );

    // Reversed: COURSE as byEntityType, STUDENT as entityType
    await expect(
      service.createMutual({
        byEntityType: TestEntity.COURSE as unknown as EntityType,
        byEntityId: 'course-1',
        entityType: TestEntity.STUDENT as unknown as EntityType,
        entityId: 'student-1',
        mutualPayload: { role: 'invalid-role', enrolledAt: '2026-01-01' },
      }),
    ).rejects.toThrow();
  });

  it('should accept valid mutualPayload in createMutual with reversed entity pair', async () => {
    const mockEntityRepo = {
      getEntity: async () => ({ data: {} }),
    };
    const mockMutualRepo = {
      checkMutualExist: async () => {},
      createMutualTransactItems: () => [],
    };
    const mockDdbUtils = {
      executeTransactWrite: async () => {},
    };
    const mockPublishEvent = async () => {};
    const mockLifecycle = {};

    const service = new MutualService(
      mockEntityConfig,
      mockEntityRepo as any,
      mockMutualRepo as any,
      mockPublishEvent as any,
      mockDdbUtils as any,
      mockLifecycle as any,
    );

    // Reversed: COURSE as byEntityType, STUDENT as entityType
    await expect(
      service.createMutual({
        byEntityType: TestEntity.COURSE as unknown as EntityType,
        byEntityId: 'course-1',
        entityType: TestEntity.STUDENT as unknown as EntityType,
        entityId: 'student-1',
        mutualPayload: { role: 'auditor', enrolledAt: '2026-01-01' },
      }),
    ).resolves.toBeDefined();
  });

  it('should allow any payload when no mutualDataSchema defined', async () => {
    const mockEntityRepo = {
      getEntity: async () => ({ data: {} }),
    };
    const mockMutualRepo = {
      checkMutualExist: async () => {},
      createMutualTransactItems: () => [],
    };
    const mockDdbUtils = {
      executeTransactWrite: async () => {},
    };
    const mockPublishEvent = async () => {};
    const mockLifecycle = {};

    const service = new MutualService(
      mockEntityConfig,
      mockEntityRepo as any,
      mockMutualRepo as any,
      mockPublishEvent as any,
      mockDdbUtils as any,
      mockLifecycle as any,
    );

    // TAG has no mutual config, so any payload should pass
    await expect(
      service.createMutual({
        byEntityType: TestEntity.TAG as unknown as EntityType,
        byEntityId: 'tag-1',
        entityType: TestEntity.STUDENT as unknown as EntityType,
        entityId: 'student-1',
        mutualPayload: { anything: 'goes', foo: 123 },
      }),
    ).resolves.toBeDefined();
  });
});
