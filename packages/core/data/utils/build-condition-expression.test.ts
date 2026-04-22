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

  it('builds $ne condition', () => {
    const result = buildConditionExpression({ status: { $ne: 'done' } });

    expect(result.ConditionExpression).toBe(
      'attribute_exists(PK) AND #data.#where_status <> :where_status_ne',
    );
    expect(result.ExpressionAttributeNames).toEqual({
      '#data': 'data',
      '#where_status': 'status',
    });
    expect(result.ExpressionAttributeValues).toEqual({
      ':where_status_ne': { S: 'done' },
    });
  });

  it('builds $gt condition', () => {
    const result = buildConditionExpression({ balance: { $gt: 10 } });

    expect(result.ConditionExpression).toBe(
      'attribute_exists(PK) AND #data.#where_balance > :where_balance_gt',
    );
    expect(result.ExpressionAttributeNames).toEqual({
      '#data': 'data',
      '#where_balance': 'balance',
    });
    expect(result.ExpressionAttributeValues).toEqual({
      ':where_balance_gt': { N: '10' },
    });
  });

  it('builds $lt condition', () => {
    const result = buildConditionExpression({ balance: { $lt: 10 } });

    expect(result.ConditionExpression).toBe(
      'attribute_exists(PK) AND #data.#where_balance < :where_balance_lt',
    );
    expect(result.ExpressionAttributeNames).toEqual({
      '#data': 'data',
      '#where_balance': 'balance',
    });
    expect(result.ExpressionAttributeValues).toEqual({
      ':where_balance_lt': { N: '10' },
    });
  });

  it('builds $gte condition', () => {
    const result = buildConditionExpression({ balance: { $gte: 10 } });

    expect(result.ConditionExpression).toBe(
      'attribute_exists(PK) AND #data.#where_balance >= :where_balance_gte',
    );
    expect(result.ExpressionAttributeNames).toEqual({
      '#data': 'data',
      '#where_balance': 'balance',
    });
    expect(result.ExpressionAttributeValues).toEqual({
      ':where_balance_gte': { N: '10' },
    });
  });

  it('builds $lte condition', () => {
    const result = buildConditionExpression({ balance: { $lte: 10 } });

    expect(result.ConditionExpression).toBe(
      'attribute_exists(PK) AND #data.#where_balance <= :where_balance_lte',
    );
    expect(result.ExpressionAttributeNames).toEqual({
      '#data': 'data',
      '#where_balance': 'balance',
    });
    expect(result.ExpressionAttributeValues).toEqual({
      ':where_balance_lte': { N: '10' },
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

  it('builds $exists true condition without attribute values', () => {
    const result = buildConditionExpression({ archivedAt: { $exists: true } });

    expect(result.ConditionExpression).toBe(
      'attribute_exists(PK) AND attribute_exists(#data.#where_archivedAt)',
    );
    expect(result.ExpressionAttributeNames).toEqual({
      '#data': 'data',
      '#where_archivedAt': 'archivedAt',
    });
    expect(result.ExpressionAttributeValues).toEqual({});
  });

  it('builds $beginsWith condition', () => {
    const result = buildConditionExpression({ status: { $beginsWith: 'pend' } });

    expect(result.ConditionExpression).toBe(
      'attribute_exists(PK) AND begins_with(#data.#where_status, :where_status_beginsWith)',
    );
    expect(result.ExpressionAttributeNames).toEqual({
      '#data': 'data',
      '#where_status': 'status',
    });
    expect(result.ExpressionAttributeValues).toEqual({
      ':where_status_beginsWith': { S: 'pend' },
    });
  });

  it('builds multi-clause condition with AND', () => {
    const result = buildConditionExpression({
      status: 'pending',
      balance: { $gte: 100 },
      code: { $beginsWith: 'TX-' },
    });

    expect(result.ConditionExpression).toBe(
      'attribute_exists(PK) AND #data.#where_status = :where_status AND #data.#where_balance >= :where_balance_gte AND begins_with(#data.#where_code, :where_code_beginsWith)',
    );
    expect(result.ExpressionAttributeNames).toEqual({
      '#data': 'data',
      '#where_status': 'status',
      '#where_balance': 'balance',
      '#where_code': 'code',
    });
    expect(result.ExpressionAttributeValues).toEqual({
      ':where_status': { S: 'pending' },
      ':where_balance_gte': { N: '100' },
      ':where_code_beginsWith': { S: 'TX-' },
    });
  });
});
