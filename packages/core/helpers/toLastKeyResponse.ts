import type { NativeAttributeValue } from '@aws-sdk/util-dynamodb';

export function toLastKeyResponse(
  lastKey?: Record<string, NativeAttributeValue>,
): string | undefined {
  if (!lastKey) {
    return;
  }

  return Buffer.from(JSON.stringify(lastKey)).toString('base64');
}
