import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type {
  AdjustmentCondition,
  UpdateCondition,
  WhereConditions,
} from '@monorise/base';
import { buildConditionExpression } from '../data/utils/build-condition-expression';
import { StandardError, StandardErrorCode } from '../errors/standard-error';

type ConditionExpressionResult = {
  ConditionExpression: string;
  ExpressionAttributeNames: Record<string, string>;
  ExpressionAttributeValues: Record<string, AttributeValue>;
};

export async function resolveAdjustmentCondition({
  conditionName,
  conditions,
  adjustments,
  getEntityData,
}: {
  conditionName: string;
  conditions: Record<string, AdjustmentCondition>;
  adjustments: Record<string, number>;
  getEntityData: () => Promise<Record<string, unknown>>;
}): Promise<ConditionExpressionResult> {
  const condition = conditions[conditionName];
  if (!condition) {
    throw new StandardError(
      StandardErrorCode.INVALID_CONDITION,
      `Unknown adjustment condition: '${conditionName}'`,
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

export async function resolveUpdateCondition({
  conditionName,
  conditions,
  getEntityData,
}: {
  conditionName: string;
  conditions: Record<string, UpdateCondition>;
  getEntityData: () => Promise<Record<string, unknown>>;
}): Promise<ConditionExpressionResult> {
  const condition = conditions[conditionName];
  if (!condition) {
    throw new StandardError(
      StandardErrorCode.INVALID_CONDITION,
      `Unknown update condition: '${conditionName}'`,
    );
  }

  let resolved: WhereConditions;

  if (typeof condition === 'function') {
    const data = await getEntityData();
    resolved = condition(data);
  } else {
    resolved = condition;
  }

  return buildConditionExpression(resolved);
}
