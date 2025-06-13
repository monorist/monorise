import type { AttributeValue } from '@aws-sdk/client-dynamodb';

export abstract class Item {
  abstract get pk(): string;
  abstract get sk(): string;
  abstract get createdAt(): string | undefined;
  abstract get updatedAt(): string | undefined;

  public keys(): Record<string, AttributeValue> {
    return {
      PK: { S: this.pk },
      SK: { S: this.sk },
    };
  }

  abstract toItem(): Record<string, AttributeValue>;

  abstract toJSON(): Record<string, unknown>;
}
