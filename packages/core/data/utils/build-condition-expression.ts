import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';

export type {
  WhereOperator,
  WhereClause,
  WhereConditions,
} from '@monorise/base';
import type { WhereConditions } from '@monorise/base';

export function buildConditionExpression(where: WhereConditions): {
  ConditionExpression: string;
  ExpressionAttributeNames: Record<string, string>;
  ExpressionAttributeValues: Record<string, AttributeValue>;
} {
  const conditions: string[] = ['attribute_exists(PK)'];
  const expressionAttributeNames: Record<string, string> = { '#data': 'data' };
  const expressionAttributeValues: Record<string, unknown> = {};

  for (const [field, clause] of Object.entries(where)) {
    const namePlaceholder = `#where_${field}`;
    expressionAttributeNames[namePlaceholder] = field;
    const fieldRef = `#data.${namePlaceholder}`;

    if (clause === null || clause === undefined) continue;

    // Bare value — treat as $eq
    if (typeof clause !== 'object') {
      const valPlaceholder = `:where_${field}`;
      expressionAttributeValues[valPlaceholder] = clause;
      conditions.push(`${fieldRef} = ${valPlaceholder}`);
      continue;
    }

    const op = clause as Record<string, unknown>;

    if ('$eq' in op) {
      const valPlaceholder = `:where_${field}_eq`;
      expressionAttributeValues[valPlaceholder] = op.$eq;
      conditions.push(`${fieldRef} = ${valPlaceholder}`);
    } else if ('$ne' in op) {
      const valPlaceholder = `:where_${field}_ne`;
      expressionAttributeValues[valPlaceholder] = op.$ne;
      conditions.push(`${fieldRef} <> ${valPlaceholder}`);
    } else if ('$gt' in op) {
      const valPlaceholder = `:where_${field}_gt`;
      expressionAttributeValues[valPlaceholder] = op.$gt;
      conditions.push(`${fieldRef} > ${valPlaceholder}`);
    } else if ('$lt' in op) {
      const valPlaceholder = `:where_${field}_lt`;
      expressionAttributeValues[valPlaceholder] = op.$lt;
      conditions.push(`${fieldRef} < ${valPlaceholder}`);
    } else if ('$gte' in op) {
      const valPlaceholder = `:where_${field}_gte`;
      expressionAttributeValues[valPlaceholder] = op.$gte;
      conditions.push(`${fieldRef} >= ${valPlaceholder}`);
    } else if ('$lte' in op) {
      const valPlaceholder = `:where_${field}_lte`;
      expressionAttributeValues[valPlaceholder] = op.$lte;
      conditions.push(`${fieldRef} <= ${valPlaceholder}`);
    } else if ('$exists' in op) {
      if (op.$exists) {
        conditions.push(`attribute_exists(${fieldRef})`);
      } else {
        conditions.push(`attribute_not_exists(${fieldRef})`);
      }
    } else if ('$beginsWith' in op) {
      const valPlaceholder = `:where_${field}_beginsWith`;
      expressionAttributeValues[valPlaceholder] = op.$beginsWith;
      conditions.push(`begins_with(${fieldRef}, ${valPlaceholder})`);
    }
  }

  return {
    ConditionExpression: conditions.join(' AND '),
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: marshall(expressionAttributeValues),
  };
}
