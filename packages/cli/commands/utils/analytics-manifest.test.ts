import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import {
  createAnalyticsManifest,
  validateSchemaEvolution,
} from './analytics-manifest';

const entity = (name: string, shape: z.ZodRawShape) => ({
  name,
  finalSchema: z.object(shape),
});

test('generates normalized entity and named mutual datasets', () => {
  const enrollment = {
    name: 'enrollment',
    mutualDataSchema: z.object({ enrolledAt: z.string().datetime() }),
  };
  const manifest = createAnalyticsManifest([
    {
      ...entity('learning-activity', {
        active: z.boolean(),
        attributes: z.object({ source: z.string() }),
        scores: z.array(z.number()),
        startedAt: z.string().datetime(),
      }),
      mutual: {
        mutualFields: {
          enrollments: { entityType: 'course', mutual: enrollment },
        },
      },
    },
  ]);

  assert.deepEqual(manifest.datasets[0], {
    kind: 'entity',
    name: 'learning-activity',
    identifier: 'learning_activity',
    idColumn: 'learning_activity_id',
    endpoints: [],
    currentTable: 'learning_activity_entities',
    historyTable: 'learning_activity_entity_changes',
    columns: [
      { name: 'active', sourceName: 'active', type: 'boolean' },
      { name: 'attributes', sourceName: 'attributes', type: 'json' },
      { name: 'scores', sourceName: 'scores', type: 'json' },
      { name: 'started_at', sourceName: 'startedAt', type: 'timestamp' },
    ],
    partition: { granularity: 'day' },
  });
  assert.deepEqual(manifest.datasets[1], {
    kind: 'mutual',
    name: 'enrollment',
    identifier: 'enrollment',
    idColumn: 'enrollment_id',
    endpoints: [
      { entityName: 'course', column: 'course_id' },
      { entityName: 'learning-activity', column: 'learning_activity_id' },
    ],
    currentTable: 'enrollment_mutuals',
    historyTable: 'enrollment_mutual_changes',
    columns: [{ name: 'enrolled_at', sourceName: 'enrolledAt', type: 'timestamp' }],
    partition: { granularity: 'day' },
  });
});

test('generates fields from an entity schema wrapped by an effect', () => {
  const manifest = createAnalyticsManifest([
    {
      name: 'activity',
      finalSchema: z
        .object({ actionType: z.string(), scheduledAt: z.string().datetime() })
        .superRefine(() => undefined),
    },
  ]);

  assert.deepEqual(manifest.datasets[0]?.columns, [
    { name: 'action_type', sourceName: 'actionType', type: 'string' },
    { name: 'scheduled_at', sourceName: 'scheduledAt', type: 'timestamp' },
  ]);
});

test('maps common scalar schemas and stores complex schemas as JSON', () => {
  enum StringStatus { OPEN = 'open' }
  enum NumericPriority { LOW, HIGH }
  const manifest = createAnalyticsManifest([
    entity('item', {
      status: z.nativeEnum(StringStatus),
      priority: z.nativeEnum(NumericPriority),
      fixed: z.literal('fixed'),
      variant: z.union([z.string(), z.number()]),
      metadata: z.record(z.string()),
      transformed: z.string().transform((value) => value.length),
    }),
  ]);

  assert.deepEqual(manifest.datasets[0]?.columns, [
    { name: 'status', sourceName: 'status', type: 'string' },
    { name: 'priority', sourceName: 'priority', type: 'double' },
    { name: 'fixed', sourceName: 'fixed', type: 'string' },
    { name: 'variant', sourceName: 'variant', type: 'json' },
    { name: 'metadata', sourceName: 'metadata', type: 'json' },
    { name: 'transformed', sourceName: 'transformed', type: 'json' },
  ]);
});

test('skips unnamed mutual datasets without blocking entity analytics', () => {
  const manifest = createAnalyticsManifest([
    {
      ...entity('role', { title: z.string() }),
      mutual: {
        mutualFields: {
          projects: { entityType: 'project' },
        },
      },
    },
  ]);

  assert.deepEqual(manifest.datasets.map((dataset) => dataset.name), ['role']);
  assert.deepEqual(manifest.unnamedMutuals, ['role.project']);
});

test('rejects invalid names and normalized columns', () => {
  assert.throws(
    () => createAnalyticsManifest([entity('Not-valid', {})]),
    /lower-kebab-case/,
  );
  assert.throws(
    () =>
      createAnalyticsManifest([
        entity('item', { 'foo-bar': z.string(), foo_bar: z.string() }),
      ]),
    /collision/,
  );
  assert.throws(
    () => createAnalyticsManifest([entity('student', { studentId: z.string() })]),
    /conflicts with generated column student_id/,
  );
});

test('names same-type relation endpoints by source and target', () => {
  const mentor = {
    name: 'mentor-link',
    entities: ['student', 'student'] as [string, string],
    mutualDataSchema: z.object({}),
  };
  const manifest = createAnalyticsManifest([
    {
      ...entity('student', {}),
      mutual: { mutualFields: { mentors: { entityType: 'student', mutual: mentor } } },
    },
  ]);

  assert.deepEqual(manifest.datasets[1]?.endpoints, [
    { entityName: 'student', column: 'student_source_id', role: 'source' },
    { entityName: 'student', column: 'student_target_id', role: 'target' },
  ]);
});

test('permits additive fields and rejects breaking schema changes', () => {
  const previous = createAnalyticsManifest([
    entity('item', { title: z.string() }),
  ]);
  const additive = createAnalyticsManifest([
    entity('item', { title: z.string(), count: z.number() }),
  ]);
  validateSchemaEvolution(previous, additive);
  const changed = createAnalyticsManifest([
    entity('item', { title: z.number() }),
  ]);
  assert.throws(
    () => validateSchemaEvolution(previous, changed),
    /explicit analytics migration/,
  );
});
