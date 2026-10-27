import type { DynamoDB } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { Repository } from './abstract/Repository.base';

/** 24h; API Gateway caps a WebSocket connection at 2h, so this only ever
 *  reaps rows a failed `$disconnect` left behind. */
const SUBSCRIPTION_TTL_SECONDS = 24 * 60 * 60;

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
          // Backstop only. $disconnect is what normally removes these, but it
          // is not guaranteed to run or to see every row, and without a TTL a
          // missed cleanup leaves the subscription forever. Comfortably longer
          // than API Gateway's own 2h max WebSocket connection lifetime, so it
          // never expires a live subscription.
          expiresAt: Math.floor(Date.now() / 1000) + SUBSCRIPTION_TTL_SECONDS,
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


  /**
   * Run a query to exhaustion.
   *
   * Every caller below fans a broadcast out to the rows it returns, so a
   * single-page query silently drops recipients past DynamoDB's 1MB limit --
   * and on `$disconnect`, silently leaves their subscription rows behind. The
   * `ConsistentRead` on these queries exists to avoid dropping recipients;
   * stopping at one page drops them the same way, just at a different
   * threshold.
   */
  private async queryAllPages(
    input: ConstructorParameters<typeof QueryCommand>[0],
  ): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = [];
    let lastKey: Record<string, unknown> | undefined;

    do {
      const result = await this.docClient.send(
        new QueryCommand({ ...input, ExclusiveStartKey: lastKey }),
      );
      items.push(...((result.Items || []) as Record<string, unknown>[]));
      lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);

    return items;
  }

  async querySubscriptionsByKey(subKey: string): Promise<SubscriptionRecord[]> {
    const items = await this.queryAllPages({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': subKey,
      },
      ConsistentRead: true,
    });
    return items as SubscriptionRecord[];
  }

  async querySubscriptionsByConnectionId(
    connectionId: string,
  ): Promise<SubscriptionRecord[]> {
    const { ENTITY_REPLICATION_INDEX } = await import(
      '../configs/service.config'
    );
    const items = await this.queryAllPages({
      TableName: this.tableName,
      IndexName: ENTITY_REPLICATION_INDEX,
      KeyConditionExpression: 'R1PK = :r1pk',
      ExpressionAttributeValues: {
        ':r1pk': `CONN#${connectionId}`,
      },
    });
    return items as SubscriptionRecord[];
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
    const items = await this.queryAllPages({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `${byEntityType}#${byEntityId}`,
      },
      ProjectionExpression: 'SK',
      ConsistentRead: true,
    });

    const connections: { entityType: string; entityId: string }[] = [];
    for (const item of items) {
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
    const items = await this.queryAllPages({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `SUB#FEED#${entityType}#${entityId}`,
      },
      ConsistentRead: true,
    });
    return items as SubscriptionRecord[];
  }
}
