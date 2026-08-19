import { describe, expect, test } from 'vitest';
import { executionParameter } from './analytics-query';

describe('analytics query execution parameters', () => {
  test('formats typed values as Athena SQL literals', () => {
    expect(executionParameter('2026-08-18', 'date')).toBe("DATE '2026-08-18'");
    expect(executionParameter("O'Brien", 'string')).toBe("'O''Brien'");
    expect(executionParameter('2026-08-18T12:00:00Z', 'timestamp')).toBe("TIMESTAMP '2026-08-18T12:00:00Z'");
    expect(executionParameter('42', 'number')).toBe('42');
    expect(executionParameter('true', 'boolean')).toBe('true');
  });
});
