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

test('generates only explicitly selected datasets', () => {
  const unnamed = { mutualDataSchema: z.object({}) };
  const manifest = createAnalyticsManifest([
    entity('role', { title: z.string() }),
    {
      ...entity('activity', { actionType: z.enum(['created']) }),
      mutual: { mutualFields: { roles: { entityType: 'role', mutual: unnamed } } },
    },
  ], { entities: ['role'], mutuals: [] });

  assert.deepEqual(manifest.datasets.map((dataset) => dataset.name), ['role']);
  assert.deepEqual(manifest.unnamedMutuals, []);
});

test('rejects unknown selected datasets', () => {
  assert.throws(
    () => createAnalyticsManifest([entity('role', {})], { entities: ['missing'] }),
    /unknown entity/,
  );
});

test('rejects invalid names, normalized columns, and unsupported types', () => {
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
    () =>
      createAnalyticsManifest([entity('item', { status: z.enum(['open']) })]),
    /Unsupported analytics schema field entity item.status/,
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
