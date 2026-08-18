import { describe, expect, test } from 'vitest';
import { datasetSql } from './analytics-materialization-processor';

describe('analytics materialization SQL', () => {
  test('creates idempotent Iceberg history and current-state merges', () => {
    const statements = datasetSql(
      {
        kind: 'entity',
        name: 'participant',
        idColumn: 'participant_id',
        endpoints: [],
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
    expect(statements[0]).toContain("WITH (table_type = 'ICEBERG'");
    expect(statements[1]).toContain('ON h.event_id = s.event_id');
    expect(statements[1]).toContain('$.data.displayName');
    expect(statements[1]).toContain(
      'try_cast(from_iso8601_timestamp(occurred_at) AS timestamp) AS occurred_at',
    );
    expect(statements[1]).not.toContain("date_add('day', -2");
    expect(statements[3]).toContain("s.operation = 'REMOVE'");
    expect(statements[0]).toContain('"participant_id" varchar');
    expect(statements[3]).toContain('PARTITION BY "participant_id"');
    expect(statements[3]).not.toContain("date_add('day', -2");
  });

  test('extracts mutual typed columns from mutualData', () => {
    const statements = datasetSql(
      {
        kind: 'mutual',
        name: 'enrollment',
        idColumn: 'enrollment_id',
        endpoints: [
          { entityName: 'student', column: 'student_id' },
          { entityName: 'course', column: 'course_id' },
        ],
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
    expect(statements[0]).toContain('"enrollment_id" varchar');
    expect(statements[0]).toContain('"student_id" varchar');
    expect(statements[1]).toContain("'$.byEntityType'");
    expect(statements[1]).toContain("'$.entityType'");
  });
});
