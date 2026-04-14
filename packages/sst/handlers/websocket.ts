import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  DynamoDBStreamEvent,
  DynamoDBStreamHandler,
} from 'aws-lambda';
import { nanoid } from 'nanoid';

const dynamodbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamodbClient);

const CONN_PREFIX = 'CONN#';
// Subscription keys
const SUB_ENTITY_TYPE = 'SUB:ENTITY:'; // SUB:ENTITY:{entityType}
const SUB_MUTUAL_TYPE = 'SUB:MUTUAL:'; // SUB:MUTUAL:{byEntityType}:{byEntityId}:{mutualEntityType}
const SUB_EPHEMERAL = 'SUB:EPHEMERAL:'; // SUB:EPHEMERAL:{channel}

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

const getWsEndpoint = () => {
  const apiId = process.env.WEBSOCKET_API_ID;
  const region = process.env.AWS_REGION || 'us-east-1';
  const stage = process.env.STAGE || 'dev';
  return `https://${apiId}.execute-api.${region}.amazonaws.com/${stage}`;
};

/**
 * $connect handler
 */
export const connect = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const connectionId = (event.requestContext as any).connectionId as string | undefined;
  if (!connectionId) {
    return { statusCode: 400, body: 'Missing connection ID' };
  }

  const token =
    event.queryStringParameters?.token ||
    event.headers?.authorization ||
    event.headers?.Authorization;

  if (!token) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  // TODO: Validate token and extract userId/workspaceId
  const userId = token; // Simplified for now
  const workspaceId = 'default';

  const tableName = getTableName();
  const ttl = Math.floor(Date.now() / 1000) + 2 * 60 * 60;

  try {
    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: `${CONN_PREFIX}${connectionId}`,
          SK: 'META',
          userId,
          workspaceId,
          connectionId,
          connectedAt: new Date().toISOString(),
          ttl,
        },
      }),
    );

    return { statusCode: 200, body: 'Connected' };
  } catch (error) {
    console.error('Error storing connection:', error);
    return { statusCode: 500, body: 'Failed to connect' };
  }
};

/**
 * $disconnect handler
 */
export const disconnect = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const connectionId = (event.requestContext as any).connectionId as string | undefined;
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
          SK: 'META',
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
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const connectionId = (event.requestContext as any).connectionId as string | undefined;
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
          const subKey = `${SUB_MUTUAL_TYPE}${byEntityType}:${byEntityId}:${mutualEntityType}`;
          await docClient.send(
            new PutCommand({
              TableName: tableName,
              Item: {
                PK: subKey,
                SK: `${CONN_PREFIX}${connectionId}`,
                connectionId,
                subscriptionType: 'mutual-type',
                byEntityType,
                byEntityId,
                mutualEntityType,
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
          const subKey = `${SUB_MUTUAL_TYPE}${byEntityType}:${byEntityId}:${mutualEntityType}`;
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
        const senderId = connResult.Items?.[0]?.userId as string | undefined;

        // Broadcast to all subscribers of this channel
        const subKey = `${SUB_EPHEMERAL}${channel}`;
        const ephemeralMessage: ServerMessage = {
          type: 'ephemeral',
          id: nanoid(),
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
    const isMutual = !sk.startsWith('META') && sk.includes('#');

    try {
      if (isMutual) {
        // Mutual type broadcast
        const skParts = sk.split('#');
        const mutualEntityType = skParts[0];
        const byEntityId = entityId; // The PK contains the byEntityId for mutuals

        const subKey = `${SUB_MUTUAL_TYPE}${entityType}:${byEntityId}:${mutualEntityType}`;

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
          id: nanoid(),
          payload: {
            byEntityType: entityType,
            byEntityId,
            mutualEntityType,
            entityId: skParts[1],
            data: image,
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
          id: nanoid(),
          payload: {
            entityType,
            entityId,
            data: isRemove ? undefined : image,
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
