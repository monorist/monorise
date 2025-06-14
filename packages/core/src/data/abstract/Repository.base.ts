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
}
