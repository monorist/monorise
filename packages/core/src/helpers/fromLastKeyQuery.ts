import type { NativeAttributeValue } from '@aws-sdk/util-dynamodb';

export function fromLastKeyQuery(
  lastKeyQuery?: string,
): Record<string, NativeAttributeValue> | undefined {
  if (!lastKeyQuery) {
    return;
  }

  return JSON.parse(Buffer.from(lastKeyQuery, 'base64').toString('utf-8'));
}
