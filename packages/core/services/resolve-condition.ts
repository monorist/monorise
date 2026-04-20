import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type { Condition, WhereConditions } from '@monorise/base';
import { buildConditionExpression } from '../data/utils/build-condition-expression';
import { StandardError, StandardErrorCode } from '../errors/standard-error';

export async function resolveCondition({
  conditionName,
  conditions,
  adjustments,
  getEntityData,
}: {
  conditionName: string;
  conditions: Record<string, Condition>;
  adjustments?: Record<string, number>;
  getEntityData: () => Promise<Record<string, unknown>>;
}): Promise<{
  ConditionExpression: string;
  ExpressionAttributeNames: Record<string, string>;
  ExpressionAttributeValues: Record<string, AttributeValue>;
}> {
  const condition = conditions[conditionName];
  if (!condition) {
    throw new StandardError(
      StandardErrorCode.INVALID_CONDITION,
      `Unknown condition: '${conditionName}'`,
    );
  }

  let resolved: WhereConditions;

  if (typeof condition === 'function') {
    const data = await getEntityData();
    resolved = condition(data, adjustments);
  } else {
    resolved = condition;
  }

  return buildConditionExpression(resolved);
}
