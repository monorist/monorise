import { describe, expect, test } from 'vitest';
import { snapshotEvent } from './analytics-backfill-processor';

describe('analytics export backfill', () => {
  test('creates an omitted SNAPSHOT baseline in the dataset partition', () => {
    process.env.ANALYTICS_MANIFEST = JSON.stringify({ datasets: [{ kind: 'entity', name: 'participant', partition: { granularity: 'hour' } }] });
    const event = snapshotEvent(
      { PK: 'participant#one', SK: '#METADATA#', entityType: 'participant', data: { name: 'Ada', passwordHash: 'secret' } },
      {} as never,
      new Date('2025-01-01T01:02:03.000Z'),
      new Set(['passwordHash']),
    );

    expect(event).toMatchObject({ operation: 'SNAPSHOT', idempotencyKey: 'snapshot:participant#one:#METADATA#:2025-01-01T01:02:03.000Z', path: 'entities/participant/event_date=2025-01-01/event_hour=01', after: { data: { name: 'Ada' } } });
  });
});
