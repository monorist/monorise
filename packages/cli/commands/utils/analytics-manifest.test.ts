import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { z } from 'zod';
import {
  createAnalyticsManifest,
  validateSchemaEvolution,
  writeAnalyticsManifest,
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

test('rejects multiple named mutuals for one entity pair', () => {
  assert.throws(
    () => createAnalyticsManifest([
      {
        ...entity('student', {}),
        mutual: {
          mutualFields: {
            enrollments: {
              entityType: 'course',
              mutual: { name: 'enrollment', mutualDataSchema: z.object({}) },
            },
            applications: {
              entityType: 'course',
              mutual: { name: 'application', mutualDataSchema: z.object({}) },
            },
          },
        },
      },
    ]),
    /both use the course::student entity pair/,
  );
});

test('permits additive fields and rejects a changed column type', () => {
  const previous = createAnalyticsManifest([
    entity('item', { title: z.string() }),
  ]);
  const additive = createAnalyticsManifest([
    entity('item', { title: z.string(), count: z.number() }),
  ]);
  assert.deepEqual(validateSchemaEvolution(previous, additive), {
    warnings: [],
    removedColumns: {},
  });
  const changed = createAnalyticsManifest([
    entity('item', { title: z.number() }),
  ]);
  assert.throws(
    () => validateSchemaEvolution(previous, changed),
    /can't change type in place: add a field with a name this dataset has never used/,
  );
});

test('warns, rather than fails, when a field or dataset is removed, and remembers it', () => {
  const previous = createAnalyticsManifest([
    entity('item', { title: z.string(), count: z.number() }),
    entity('note', { body: z.string() }),
  ]);
  const next = createAnalyticsManifest([
    entity('item', { title: z.string() }),
  ]);

  const { warnings, removedColumns } = validateSchemaEvolution(previous, next);

  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /item\.count was removed or renamed/);
  assert.match(warnings[0], /in the current table existing rows keep their last value/);
  assert.match(warnings[1], /dataset note was removed/);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(removedColumns).map(([id, columns]) => [
        id,
        columns.map((column) => `${column.name}:${column.type}`),
      ]),
    ),
    { item: ['count:double'], note: ['body:string'] },
  );
});

test('rejects a removed field that comes back with another type, in a later build', () => {
  const first = createAnalyticsManifest([
    entity('item', { title: z.string(), count: z.number() }),
  ]);
  const withoutCount = createAnalyticsManifest([
    entity('item', { title: z.string() }),
  ]);
  // What writeAnalyticsManifest writes after the removal.
  const second = {
    ...withoutCount,
    removedColumns: validateSchemaEvolution(first, withoutCount).removedColumns,
  };

  assert.throws(
    () =>
      validateSchemaEvolution(
        second,
        createAnalyticsManifest([
          entity('item', { title: z.string(), count: z.string() }),
        ]),
      ),
    /item\.count was removed earlier as double.*can't come back as string/,
  );
  // The same type is fine, and the column is live again.
  assert.deepEqual(
    validateSchemaEvolution(second, first).removedColumns,
    {},
  );
});

test('rejects a removed dataset that comes back with another column type', () => {
  const first = createAnalyticsManifest([
    entity('item', { title: z.string() }),
    entity('note', { body: z.string() }),
  ]);
  const withoutNote = createAnalyticsManifest([
    entity('item', { title: z.string() }),
  ]);
  const second = {
    ...withoutNote,
    removedColumns: validateSchemaEvolution(first, withoutNote).removedColumns,
  };

  assert.throws(
    () =>
      validateSchemaEvolution(
        second,
        createAnalyticsManifest([
          entity('item', { title: z.string() }),
          entity('note', { body: z.number() }),
        ]),
      ),
    /note\.body was removed earlier as string/,
  );
});

test('writeAnalyticsManifest carries removed columns forward between builds', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-manifest-'));
  const warn = console.warn;
  console.warn = () => {};
  try {
    const read = () =>
      JSON.parse(
        fs.readFileSync(path.join(dir, 'analytics-manifest.json'), 'utf8'),
      );
    writeAnalyticsManifest(dir, [
      entity('item', { title: z.string(), count: z.number() }),
    ]);
    writeAnalyticsManifest(dir, [entity('item', { title: z.string() })]);
    assert.deepEqual(
      read().removedColumns.item.map((column: { name: string }) => column.name),
      ['count'],
    );
    // An unrelated build in between keeps it.
    writeAnalyticsManifest(dir, [
      entity('item', { title: z.string(), note: z.string() }),
    ]);
    assert.throws(
      () =>
        writeAnalyticsManifest(dir, [
          entity('item', { title: z.string(), count: z.boolean() }),
        ]),
      /item\.count was removed earlier as double/,
    );
  } finally {
    console.warn = warn;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
