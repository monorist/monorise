import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
  APIGatewayProxyResultV2,
  APIGatewayProxyWebsocketEventV2,
  DynamoDBStreamEvent,
  DynamoDBStreamHandler,
} from 'aws-lambda';
import { ulid } from 'ulid';

// $connect event includes query params and headers, but the base WebSocket type doesn't model them
type WebSocketConnectEvent = APIGatewayProxyWebsocketEventV2 & {
  queryStringParameters?: Record<string, string | undefined>;
  headers?: Record<string, string | undefined>;
};

const dynamodbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamodbClient);

const CONN_PREFIX = 'CONN#';
const TICKET_PREFIX = 'TICKET#';
// Subscription keys
const SUB_ENTITY_TYPE = 'SUB#ENTITY#'; // SUB#ENTITY#{entityType}
const SUB_MUTUAL_TYPE = 'SUB#MUTUAL#'; // SUB#MUTUAL#{byEntityType}#{byEntityId}#{entityType}
const SUB_EPHEMERAL = 'SUB#EPHEMERAL#'; // SUB#EPHEMERAL#{channel}
const SUB_FEED = 'SUB#FEED#'; // SUB#FEED#{entityType}#{entityId}
const METADATA_SK = '#METADATA#';

interface ClientMessage {
  action: 'subscribe' | 'unsubscribe' | 'ephemeral' | 'ping';
  id: string;
  payload: {
    entityType?: string;
    byEntityType?: string;
    byEntityId?: string;
    mutualEntityType?: string;
    channel?: string;
    data?: unknown;
  };
}

interface ServerMessage {
  type:
    | 'entity.created'
    | 'entity.updated'
    | 'entity.deleted'
    | 'mutual.created'
    | 'mutual.updated'
    | 'mutual.deleted'
    | 'ephemeral'
    | 'ack'
    | 'error'
    | 'pong';
  id: string;
  payload: unknown;
}

const getTableName = () => process.env.CORE_TABLE || '';

const getWsEndpoint = () => process.env.WEBSOCKET_MANAGEMENT_ENDPOINT || '';

/**
 * Validate a ticket and return its data, then delete it (one-time use).
 */
const validateTicket = async (
  ticket: string,
  tableName: string,
): Promise<{
  entityType: string;
  entityId: string;
  feedTypes: string[];
} | null> => {
  const result = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `${TICKET_PREFIX}${ticket}`,
      },
      ConsistentRead: true,
    }),
  );

  const item = result.Items?.[0];
  if (!item) return null;

  // Check expiry
  const expiresAt = item.expiresAt as number;
  if (expiresAt && expiresAt < Math.floor(Date.now() / 1000)) {
    return null;
  }

  // Delete ticket (one-time use)
  await docClient.send(
    new DeleteCommand({
      TableName: tableName,
      Key: {
        PK: `${TICKET_PREFIX}${ticket}`,
        SK: METADATA_SK,
      },
    }),
  );

  return {
    entityType: item.entityType as string,
    entityId: item.entityId as string,
    feedTypes: (item.feedTypes as string[]) || [],
  };
};

/**
 * $connect handler
 * Supports two auth modes:
 * - ticket: ?ticket=abc123 (issued via /ws/ticket/:entityType/:entityId)
 * - token: ?token=userId (simplified direct auth)
 */
export const connect = async (
  event: WebSocketConnectEvent,
): Promise<APIGatewayProxyResultV2> => {
  const connectionId = event.requestContext.connectionId;
  if (!connectionId) {
    return { statusCode: 400, body: 'Missing connection ID' };
  }

  const tableName = getTableName();
  const expiresAt = Math.floor(Date.now() / 1000) + 2 * 60 * 60;

  const ticket = event.queryStringParameters?.ticket;
  const token =
    event.queryStringParameters?.token ||
    event.headers?.authorization ||
    event.headers?.Authorization;

  if (!ticket && !token) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  try {
    let entityType: string | undefined;
    let entityId: string | undefined;
    let feedTypes: string[] | undefined;

    if (ticket) {
      // Ticket-based auth (entity feed)
      const ticketData = await validateTicket(ticket, tableName);
      if (!ticketData) {
        return { statusCode: 401, body: 'Invalid or expired ticket' };
      }
      entityType = ticketData.entityType;
      entityId = ticketData.entityId;
      feedTypes = ticketData.feedTypes;
    } else {
      // Token-based auth (simple/direct) — token is treated as entityId
      entityId = token!;
    }

    // Store connection record
    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: `${CONN_PREFIX}${connectionId}`,
          SK: METADATA_SK,
          connectionId,
          ...(entityType && { entityType }),
          ...(entityId && { entityId }),
          connectedAt: new Date().toISOString(),
          expiresAt,
        },
      }),
    );

    // If ticket-based, auto-subscribe to feed
    if (entityType && entityId && feedTypes) {
      const feedSubKey = `${SUB_FEED}${entityType}#${entityId}`;
      await docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            PK: feedSubKey,
            SK: `${CONN_PREFIX}${connectionId}`,
            R1PK: `${CONN_PREFIX}${connectionId}`,
            R1SK: feedSubKey,
            connectionId,
            subscriptionType: 'feed',
            entityType,
            entityId,
            feedTypes,
            subscribedAt: new Date().toISOString(),
            expiresAt,
          },
        }),
      );
    }

    return { statusCode: 200, body: 'Connected' };
  } catch (error) {
    console.error('Error in $connect:', error);
    return { statusCode: 500, body: 'Failed to connect' };
  }
};

/**
 * $disconnect handler
 */
export const disconnect = async (
  event: APIGatewayProxyWebsocketEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const connectionId = event.requestContext.connectionId;
  if (!connectionId) {
    return { statusCode: 400, body: 'Missing connection ID' };
  }

  const tableName = getTableName();

  try {
    // Delete connection record
    await docClient.send(
      new DeleteCommand({
        TableName: tableName,
        Key: {
          PK: `${CONN_PREFIX}${connectionId}`,
          SK: METADATA_SK,
        },
      }),
    );

    // Note: Subscriptions are automatically cleaned up via DynamoDB Stream
    // when connection records are deleted

    return { statusCode: 200, body: 'Disconnected' };
  } catch (error) {
    console.error('Error cleaning up connection:', error);
    return { statusCode: 500, body: 'Failed to disconnect' };
  }
};

/**
 * $default handler - route messages
 */
export const $default = async (
  event: APIGatewayProxyWebsocketEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const connectionId = event.requestContext.connectionId;
  if (!connectionId || !event.body) {
    return { statusCode: 400, body: 'Invalid message' };
  }

  let message: ClientMessage;
  try {
    message = JSON.parse(event.body) as ClientMessage;
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const tableName = getTableName();
  const wsEndpoint = getWsEndpoint();
  const managementApi = new ApiGatewayManagementApiClient({
    endpoint: wsEndpoint,
  });

  try {
    switch (message.action) {
      case 'subscribe': {
        const { entityType, byEntityType, byEntityId, mutualEntityType, channel } =
          message.payload;

        // Entity type subscription
        if (entityType && !byEntityType) {
          const subKey = `${SUB_ENTITY_TYPE}${entityType}`;
          await docClient.send(
            new PutCommand({
              TableName: tableName,
              Item: {
                PK: subKey,
                SK: `${CONN_PREFIX}${connectionId}`,
                R1PK: `${CONN_PREFIX}${connectionId}`,
                R1SK: subKey,
                connectionId,
                subscriptionType: 'entity-type',
                entityType,
                subscribedAt: new Date().toISOString(),
              },
            }),
          );
        }
        // Mutual type subscription
        else if (byEntityType && byEntityId && mutualEntityType) {
          const subKey = `${SUB_MUTUAL_TYPE}${byEntityType}#${byEntityId}#${mutualEntityType}`;
          await docClient.send(
            new PutCommand({
              TableName: tableName,
              Item: {
                PK: subKey,
                SK: `${CONN_PREFIX}${connectionId}`,
                R1PK: `${CONN_PREFIX}${connectionId}`,
                R1SK: subKey,
                connectionId,
                subscriptionType: 'mutual-type',
                byEntityType,
                byEntityId,
                entityType: mutualEntityType,
                subscribedAt: new Date().toISOString(),
              },
            }),
          );
        }
        // Ephemeral channel subscription
        else if (channel) {
          const subKey = `${SUB_EPHEMERAL}${channel}`;
          await docClient.send(
            new PutCommand({
              TableName: tableName,
              Item: {
                PK: subKey,
                SK: `${CONN_PREFIX}${connectionId}`,
                R1PK: `${CONN_PREFIX}${connectionId}`,
                R1SK: subKey,
                connectionId,
                subscriptionType: 'ephemeral',
                channel,
                subscribedAt: new Date().toISOString(),
              },
            }),
          );
        } else {
          return { statusCode: 400, body: 'Invalid subscription parameters' };
        }

        // Send ack
        const ackMessage: ServerMessage = {
          type: 'ack',
          id: message.id,
          payload: { action: 'subscribe', success: true },
        };

        await managementApi.send(
          new PostToConnectionCommand({
            ConnectionId: connectionId,
            Data: JSON.stringify(ackMessage),
          }),
        );

        return { statusCode: 200, body: 'Subscribed' };
      }

      case 'unsubscribe': {
        const { entityType, byEntityType, byEntityId, mutualEntityType, channel } =
          message.payload;

        if (entityType && !byEntityType) {
          const subKey = `${SUB_ENTITY_TYPE}${entityType}`;
          await docClient.send(
            new DeleteCommand({
              TableName: tableName,
              Key: {
                PK: subKey,
                SK: `${CONN_PREFIX}${connectionId}`,
              },
            }),
          );
        } else if (byEntityType && byEntityId && mutualEntityType) {
          const subKey = `${SUB_MUTUAL_TYPE}${byEntityType}#${byEntityId}#${mutualEntityType}`;
          await docClient.send(
            new DeleteCommand({
              TableName: tableName,
              Key: {
                PK: subKey,
                SK: `${CONN_PREFIX}${connectionId}`,
              },
            }),
          );
        } else if (channel) {
          const subKey = `${SUB_EPHEMERAL}${channel}`;
          await docClient.send(
            new DeleteCommand({
              TableName: tableName,
              Key: {
                PK: subKey,
                SK: `${CONN_PREFIX}${connectionId}`,
              },
            }),
          );
        }

        const ackMessage: ServerMessage = {
          type: 'ack',
          id: message.id,
          payload: { action: 'unsubscribe', success: true },
        };

        await managementApi.send(
          new PostToConnectionCommand({
            ConnectionId: connectionId,
            Data: JSON.stringify(ackMessage),
          }),
        );

        return { statusCode: 200, body: 'Unsubscribed' };
      }

      case 'ping': {
        const pongMessage: ServerMessage = {
          type: 'pong',
          id: message.id,
          payload: { timestamp: Date.now() },
        };

        await managementApi.send(
          new PostToConnectionCommand({
            ConnectionId: connectionId,
            Data: JSON.stringify(pongMessage),
          }),
        );

        return { statusCode: 200, body: 'Pong' };
      }

      case 'ephemeral': {
        const { channel, data } = message.payload;
        if (!channel) {
          return { statusCode: 400, body: 'Missing channel' };
        }

        // Get sender info from connection record
        const connResult = await docClient.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: 'PK = :pk',
            ExpressionAttributeValues: {
              ':pk': `${CONN_PREFIX}${connectionId}`,
            },
          }),
        );
        const senderId = connResult.Items?.[0]?.entityId as string | undefined;

        // Broadcast to all subscribers of this channel
        const subKey = `${SUB_EPHEMERAL}${channel}`;
        const ephemeralMessage: ServerMessage = {
          type: 'ephemeral',
          id: ulid(),
          payload: { channel, data, senderId },
        };

        await broadcastToSubscribers(
          managementApi,
          docClient,
          tableName,
          subKey,
          ephemeralMessage,
          connectionId, // Exclude sender
        );

        return { statusCode: 200, body: 'Broadcasted' };
      }

      default:
        return { statusCode: 400, body: 'Unknown action' };
    }
  } catch (error) {
    console.error('Error handling message:', error);

    try {
      const errorMessage: ServerMessage = {
        type: 'error',
        id: message.id,
        payload: { message: 'Internal server error' },
      };

      await managementApi.send(
        new PostToConnectionCommand({
          ConnectionId: connectionId,
          Data: JSON.stringify(errorMessage),
        }),
      );
    } catch {
      // Ignore
    }

    return { statusCode: 500, body: 'Internal server error' };
  }
};

/**
 * Broadcast handler - triggered by DynamoDB Streams
 */
export const broadcast: DynamoDBStreamHandler = async (
  event: DynamoDBStreamEvent,
) => {
  const tableName = getTableName();
  const wsEndpoint = getWsEndpoint();
  const managementApi = new ApiGatewayManagementApiClient({
    endpoint: wsEndpoint,
  });

  for (const record of event.Records) {
    const isInsert = record.eventName === 'INSERT';
    const isModify = record.eventName === 'MODIFY';
    const isRemove = record.eventName === 'REMOVE';

    if (!isInsert && !isModify && !isRemove) continue;

    const newImage = record.dynamodb?.NewImage;
    const oldImage = record.dynamodb?.OldImage;
    const image = newImage || oldImage;
    if (!image) continue;

    const pk = image.PK?.S || '';
    const sk = image.SK?.S || '';

    // Skip connection/subscription records
    if (pk.startsWith('CONN#') || pk.startsWith('SUB:')) continue;

    const pkParts = pk.split('#');
    if (pkParts.length < 2) continue;

    const entityType = pkParts[0];
    const entityId = pkParts[1];
    const isMutual = !sk.startsWith('#METADATA#') && sk.includes('#');

    try {
      if (isMutual) {
        // Mutual type broadcast
        const skParts = sk.split('#');
        const mutualEntityType = skParts[0];
        const byEntityId = entityId; // The PK contains the byEntityId for mutuals

        const subKey = `${SUB_MUTUAL_TYPE}${entityType}#${byEntityId}#${mutualEntityType}`;

        const subscribersResult = await docClient.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: 'PK = :pk',
            ExpressionAttributeValues: { ':pk': subKey },
          }),
        );

        if (!subscribersResult.Items?.length) continue;

        let eventType: ServerMessage['type'];
        if (isInsert) eventType = 'mutual.created';
        else if (isModify) eventType = 'mutual.updated';
        else eventType = 'mutual.deleted';

        const message: ServerMessage = {
          type: eventType,
          id: ulid(),
          payload: {
            byEntityType: entityType,
            byEntityId,
            mutualEntityType,
            entityId: skParts[1],
            data: isRemove ? undefined : unmarshall(image as Record<string, any>),
          },
        };

        await broadcastToSubscribers(
          managementApi,
          docClient,
          tableName,
          subKey,
          message,
        );
      } else {
        // Entity type broadcast
        const subKey = `${SUB_ENTITY_TYPE}${entityType}`;

        const subscribersResult = await docClient.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: 'PK = :pk',
            ExpressionAttributeValues: { ':pk': subKey },
          }),
        );

        if (!subscribersResult.Items?.length) continue;

        let eventType: ServerMessage['type'];
        if (isInsert) eventType = 'entity.created';
        else if (isModify) eventType = 'entity.updated';
        else eventType = 'entity.deleted';

        const message: ServerMessage = {
          type: eventType,
          id: ulid(),
          payload: {
            entityType,
            entityId,
            data: isRemove ? undefined : unmarshall(image as Record<string, any>),
          },
        };

        await broadcastToSubscribers(
          managementApi,
          docClient,
          tableName,
          subKey,
          message,
        );
      }
    } catch (error) {
      console.error('Error broadcasting:', error);
    }
  }
};

async function broadcastToSubscribers(
  managementApi: ApiGatewayManagementApiClient,
  docClient: DynamoDBDocumentClient,
  tableName: string,
  subKey: string,
  message: ServerMessage,
  excludeConnectionId?: string,
): Promise<void> {
  const subscribersResult = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': subKey },
    }),
  );

  if (!subscribersResult.Items?.length) return;

  const messageData = JSON.stringify(message);

  for (const subscriber of subscribersResult.Items) {
    const subscriberConnectionId = subscriber.connectionId as string;

    // Skip excluded connection (e.g., sender of ephemeral message)
    if (excludeConnectionId && subscriberConnectionId === excludeConnectionId) {
      continue;
    }

    try {
      await managementApi.send(
        new PostToConnectionCommand({
          ConnectionId: subscriberConnectionId,
          Data: messageData,
        }),
      );
    } catch (error: unknown) {
      // Clean up stale connections
      if (
        error instanceof Error &&
        (error.message?.includes('GoneException') ||
          error.message?.includes('410'))
      ) {
        await docClient.send(
          new DeleteCommand({
            TableName: tableName,
            Key: {
              PK: subKey,
              SK: `CONN#${subscriberConnectionId}`,
            },
          }),
        );
      }
    }
  }
}
