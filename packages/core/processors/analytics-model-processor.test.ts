import { describe, expect, test } from 'vitest';
import { modelStatements } from './analytics-model-processor';

describe('analytics model SQL', () => {
  test('creates an Iceberg table and refreshes only its trailing partitions', () => {
    const statements = modelStatements({
      name: 'daily-transactions',
      partitionColumn: 'day',
      lookbackDays: 3,
      sql: 'SELECT CAST(occurred_at AS date) AS day FROM transactions WHERE occurred_at >= {{windowStart}} AND occurred_at < {{windowEnd}}',
    }, 'analytics', 'bucket', new Date('2026-07-27T12:00:00.000Z'));

    expect(statements[0]).toContain('"analytics"."daily_transactions"');
    expect(statements[0]).toContain("table_type = 'ICEBERG'");
    expect(statements[0]).toContain("s3://bucket/models/daily_transactions/");
    expect(statements[1]).toContain('"day" >= DATE \'2026-07-24\'');
    expect(statements[2]).toContain("'2026-07-24T12:00:00.000Z'");
    expect(statements[2]).toContain("'2026-07-27T12:00:00.000Z'");
  });
});
