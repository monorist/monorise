import type { DynamoDB } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { Repository } from './abstract/Repository.base';

export interface ConnectionRecord {
  connectionId: string;
  entityType?: string;
  entityId?: string;
  connectedAt?: string;
  expiresAt?: number;
}

export interface SubscriptionRecord {
  PK: string;
  SK: string;
  connectionId: string;
  subscriptionType: string;
  feedTypes?: string[];
  [key: string]: unknown;
}

export interface TicketData {
  entityType: string;
  entityId: string;
  feedTypes: string[];
}

export class WebSocketRepository extends Repository {
  private docClient: DynamoDBDocumentClient;

  constructor(
    private tableName: string,
    private dynamodbClient: DynamoDB,
  ) {
    super();
    this.docClient = DynamoDBDocumentClient.from(dynamodbClient);
  }

  async createConnection(
    connectionId: string,
    metadata: Record<string, unknown>,
    expiresAt: number,
  ): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `CONN#${connectionId}`,
          SK: '#METADATA#',
          connectionId,
          ...metadata,
          expiresAt,
        },
      }),
    );
  }

  async getConnection(
    connectionId: string,
  ): Promise<ConnectionRecord | undefined> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: {
          ':pk': `CONN#${connectionId}`,
        },
      }),
    );
    return result.Items?.[0] as ConnectionRecord | undefined;
  }

  async deleteConnection(connectionId: string): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: {
          PK: `CONN#${connectionId}`,
          SK: '#METADATA#',
        },
      }),
    );
  }

  async createSubscription(
    subKey: string,
    connectionId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: subKey,
          SK: `CONN#${connectionId}`,
          R1PK: `CONN#${connectionId}`,
          R1SK: subKey,
          connectionId,
          ...data,
        },
      }),
    );
  }

  async deleteSubscription(
    subKey: string,
    connectionId: string,
  ): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: {
          PK: subKey,
          SK: `CONN#${connectionId}`,
        },
      }),
    );
  }

  async querySubscriptionsByKey(subKey: string): Promise<SubscriptionRecord[]> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: {
          ':pk': subKey,
        },
        ConsistentRead: true,
      }),
    );
    return (result.Items || []) as SubscriptionRecord[];
  }

  async querySubscriptionsByConnectionId(
    connectionId: string,
  ): Promise<SubscriptionRecord[]> {
    const { ENTITY_REPLICATION_INDEX } = await import(
      '../configs/service.config'
    );
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: ENTITY_REPLICATION_INDEX,
        KeyConditionExpression: 'R1PK = :r1pk',
        ExpressionAttributeValues: {
          ':r1pk': `CONN#${connectionId}`,
        },
      }),
    );
    return (result.Items || []) as SubscriptionRecord[];
  }

  async createTicket(
    ticket: string,
    entityType: string,
    entityId: string,
    feedTypes: string[],
    expiresAt: number,
  ): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `TICKET#${ticket}`,
          SK: '#METADATA#',
          entityType,
          entityId,
          feedTypes,
          createdAt: new Date().toISOString(),
          expiresAt,
        },
      }),
    );
  }

  async consumeTicket(ticket: string): Promise<TicketData | null> {
    try {
      const result = await this.docClient.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: {
            PK: `TICKET#${ticket}`,
            SK: '#METADATA#',
          },
          ConditionExpression: 'attribute_exists(PK)',
          ReturnValues: 'ALL_OLD',
        }),
      );

      const item = result.Attributes;
      if (!item) return null;

      const expiresAt = item.expiresAt as number;
      if (expiresAt && expiresAt < Math.floor(Date.now() / 1000)) {
        return null;
      }

      return {
        entityType: item.entityType as string,
        entityId: item.entityId as string,
        feedTypes: (item.feedTypes as string[]) || [],
      };
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.name === 'ConditionalCheckFailedException'
      ) {
        return null;
      }
      throw error;
    }
  }

  async queryMutualConnections(
    byEntityType: string,
    byEntityId: string,
  ): Promise<{ entityType: string; entityId: string }[]> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: {
          ':pk': `${byEntityType}#${byEntityId}`,
        },
        ProjectionExpression: 'SK',
        ConsistentRead: true,
      }),
    );

    const connections: { entityType: string; entityId: string }[] = [];
    for (const item of result.Items || []) {
      const sk = item.SK as string;
      if (!sk || sk === '#METADATA#' || sk.startsWith('#')) continue;

      const parts = sk.split('#');
      if (parts.length >= 2) {
        connections.push({ entityType: parts[0], entityId: parts[1] });
      }
    }
    return connections;
  }

  async queryFeedSubscriptions(
    entityType: string,
    entityId: string,
  ): Promise<SubscriptionRecord[]> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: {
          ':pk': `SUB#FEED#${entityType}#${entityId}`,
        },
        ConsistentRead: true,
      }),
    );
    return (result.Items || []) as SubscriptionRecord[];
  }
}
