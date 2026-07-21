import { describe, expect, test } from 'vitest';
import { datasetSql } from './analytics-materialization-processor';

describe('analytics materialization SQL', () => {
  test('creates idempotent Iceberg history and current-state merges', () => {
    const statements = datasetSql(
      {
        kind: 'entity',
        name: 'participant',
        currentTable: 'participant_entities',
        historyTable: 'participant_entity_changes',
        columns: [
          { name: 'display_name', sourceName: 'displayName', type: 'string' },
        ],
      },
      'monorise_analytics',
      'analytics-bucket',
    );

    expect(statements).toHaveLength(4);
    expect(statements[0]).toContain("table_type'='ICEBERG'");
    expect(statements[1]).toContain('ON h.event_id = s.event_id');
    expect(statements[1]).toContain('$.data.displayName');
    expect(statements[1]).toContain(
      'try_cast(from_iso8601_timestamp(occurred_at) AS timestamp) AS occurred_at',
    );
    expect(statements[1]).not.toContain("date_add('day', -2");
    expect(statements[3]).toContain("s.operation = 'REMOVE'");
    expect(statements[3]).not.toContain("date_add('day', -2");
  });

  test('extracts mutual typed columns from mutualData', () => {
    const statements = datasetSql(
      {
        kind: 'mutual',
        name: 'enrollment',
        currentTable: 'enrollment_mutuals',
        historyTable: 'enrollment_mutual_changes',
        columns: [
          { name: 'enrolled_at', sourceName: 'enrolledAt', type: 'timestamp' },
        ],
      },
      'monorise_analytics',
      'analytics-bucket',
    );

    expect(statements[1]).toContain('$.mutualData.enrolledAt');
  });
});
