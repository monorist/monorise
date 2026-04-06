import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';

function flattenObject(
  obj: Record<string, unknown>,
  parentKey = '',
  result: Record<string, unknown> = {},
  level = 1,
  opts?: {
    maxLevel?: number;
  },
): Record<string, unknown> {
  const MAX_LEVEL = opts?.maxLevel ?? 2;

  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const propName = parentKey ? `${parentKey}.${key}` : key;
      if (
        typeof obj[key] === 'object' &&
        obj[key] !== null &&
        !Array.isArray(obj[key]) &&
        level < MAX_LEVEL
      ) {
        flattenObject(
          obj[key] as Record<string, unknown>,
          propName,
          result,
          level + 1,
          opts,
        );
      } else {
        result[propName] = obj[key];
      }
    }
  }
  return result;
}

export abstract class Repository {
  toUpdate(
    parsedUpdateData: Record<string, unknown>,
    opts?: {
      // to limit the partial update depth for an object
      // in some scenario, we have to ensure the object to be written must be an object instead of undefined/null
      // eg, writing to data.cover.name must ensure data.cover is an object already else we will get error
      maxLevel?: number;
    },
  ): {
    UpdateExpression: string;
    ExpressionAttributeNames: Record<string, string>;
    ExpressionAttributeValues: Record<string, AttributeValue>;
  } {
    const flattenedData = flattenObject(parsedUpdateData, '', {}, 1, opts);

    let updateExpression = '';
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, unknown> = {};

    for (const key in flattenedData) {
      if (updateExpression.length > 0) {
        updateExpression += ', ';
      }
      const attributePath = key
        .split('.')
        .map((part) => `#${part}`)
        .join('.');
      const valuePlaceholder = `:${key.replace(/\./g, '_')}`;

      updateExpression += `${attributePath} = ${valuePlaceholder}`;

      key.split('.').forEach((part) => {
        expressionAttributeNames[`#${part}`] = part;
      });

      expressionAttributeValues[valuePlaceholder] = flattenedData[key];
    }

    updateExpression = `SET ${updateExpression}`;

    const updateAttributes = {
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: {
        ...expressionAttributeNames,
      },
      ExpressionAttributeValues: {
        ...marshall(expressionAttributeValues),
      },
    };

    return updateAttributes;
  }

  toAdjustUpdate(
    adjustments: Record<string, number>,
    constraints?: {
      [field: string]: {
        min?: number;
        max?: number;
        minField?: string;
        maxField?: string;
      };
    },
    prefix = 'data',
  ): {
    UpdateExpression: string;
    ConditionExpression?: string;
    ExpressionAttributeNames: Record<string, string>;
    ExpressionAttributeValues: Record<string, AttributeValue>;
  } {
    const parts: string[] = [];
    const conditionParts: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, unknown> = {};

    expressionAttributeNames[`#${prefix}`] = prefix;

    for (const field of Object.keys(adjustments)) {
      const namePlaceholder = `#${field}`;
      const valuePlaceholder = `:${field}`;
      const fieldExpr = `if_not_exists(#${prefix}.${namePlaceholder}, :zero)`;

      parts.push(
        `#${prefix}.${namePlaceholder} = ${fieldExpr} + ${valuePlaceholder}`,
      );

      expressionAttributeNames[namePlaceholder] = field;
      expressionAttributeValues[valuePlaceholder] = adjustments[field];

      // Build constraint conditions using pre-computed thresholds.
      // ConditionExpression checks the current value against the threshold.
      // UpdateExpression applies the delta. Both in a single atomic UpdateItem.
      //
      // For min with negative delta: currentValue >= (min + abs(delta))
      // For max with positive delta: currentValue <= (max - delta)
      //
      // For dynamic minField/maxField: the service layer reads the entity's
      // field value first, then passes it as a resolved static constraint.
      if (constraints?.[field]) {
        const constraint = constraints[field];
        const delta = adjustments[field];
        const currentFieldRef = `#${prefix}.${namePlaceholder}`;

        // Static min — only check when decrementing
        // Condition: currentValue >= min + abs(delta)
        // If field doesn't exist, condition fails (safe — can't withdraw from nothing)
        if (constraint.min !== undefined && delta < 0) {
          const thresholdPlaceholder = `:${field}_min_threshold`;
          conditionParts.push(`${currentFieldRef} >= ${thresholdPlaceholder}`);
          expressionAttributeValues[thresholdPlaceholder] = constraint.min - delta;
        }
        // Static max — only check when incrementing
        // Condition: currentValue <= max - delta
        if (constraint.max !== undefined && delta > 0) {
          const thresholdPlaceholder = `:${field}_max_threshold`;
          conditionParts.push(`${currentFieldRef} <= ${thresholdPlaceholder}`);
          expressionAttributeValues[thresholdPlaceholder] = constraint.max - delta;
        }
      }
    }

    expressionAttributeValues[':zero'] = 0;

    return {
      UpdateExpression: `SET ${parts.join(', ')}`,
      ...(conditionParts.length > 0 && {
        ConditionExpression: conditionParts.join(' AND '),
      }),
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: marshall(expressionAttributeValues),
    };
  }
}
