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
      mutual: { mutualFields: { enrollments: { mutual: enrollment } } },
    },
  ]);

  assert.deepEqual(manifest.datasets[0], {
    kind: 'entity',
    name: 'learning-activity',
    identifier: 'learning_activity',
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
  assert.equal(manifest.datasets[1]?.currentTable, 'enrollment_mutuals');
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
