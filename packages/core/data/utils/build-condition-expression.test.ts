import { describe, expect, it } from 'vitest';
import { buildConditionExpression } from './build-condition-expression';

describe('buildConditionExpression', () => {
  it('builds base condition when where is empty', () => {
    const result = buildConditionExpression({});

    expect(result.ConditionExpression).toBe('attribute_exists(PK)');
    expect(result.ExpressionAttributeNames).toEqual({ '#data': 'data' });
    expect(result.ExpressionAttributeValues).toEqual({});
  });

  it('treats bare value as $eq shorthand', () => {
    const result = buildConditionExpression({ status: 'pending' });

    expect(result.ConditionExpression).toBe(
      'attribute_exists(PK) AND #data.#where_status = :where_status',
    );
    expect(result.ExpressionAttributeNames).toEqual({
      '#data': 'data',
      '#where_status': 'status',
    });
    expect(result.ExpressionAttributeValues).toEqual({
      ':where_status': { S: 'pending' },
    });
  });

  it('builds explicit $eq condition', () => {
    const result = buildConditionExpression({ status: { $eq: 'pending' } });

    expect(result.ConditionExpression).toBe(
      'attribute_exists(PK) AND #data.#where_status = :where_status_eq',
    );
    expect(result.ExpressionAttributeNames).toEqual({
      '#data': 'data',
      '#where_status': 'status',
    });
    expect(result.ExpressionAttributeValues).toEqual({
      ':where_status_eq': { S: 'pending' },
    });
  });

  it('builds $exists condition without attribute values', () => {
    const result = buildConditionExpression({ archivedAt: { $exists: false } });

    expect(result.ConditionExpression).toBe(
      'attribute_exists(PK) AND attribute_not_exists(#data.#where_archivedAt)',
    );
    expect(result.ExpressionAttributeNames).toEqual({
      '#data': 'data',
      '#where_archivedAt': 'archivedAt',
    });
    expect(result.ExpressionAttributeValues).toEqual({});
  });
});
