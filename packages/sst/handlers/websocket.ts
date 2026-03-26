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

// Initialize DynamoDB client
const dynamodbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamodbClient);

// Connection and subscription prefixes for single-table design
const CONN_PREFIX = 'CONN#';
const SUB_PREFIX = 'SUB#';

// Message types
interface ClientMessage {
  action: 'subscribe' | 'unsubscribe' | 'mutate' | 'ping';
  id: string;
  payload: {
    entityType?: string;
    entityId?: string;
    byEntityType?: string;
    byEntityId?: string;
    data?: unknown;
  };
}

interface ServerMessage {
  type:
    | 'entity.update'
    | 'entity.delete'
    | 'mutual.update'
    | 'mutual.delete'
    | 'ack'
    | 'error'
    | 'pong';
  id: string;
  payload: unknown;
}

// Helper to get table name from environment
const getTableName = () => process.env.CORE_TABLE || '';

// Helper to get WebSocket endpoint
const getWsEndpoint = () => {
  const apiId = process.env.WEBSOCKET_API_ID;
  const region = process.env.AWS_REGION || 'us-east-1';
  const stage = process.env.STAGE || 'dev';
  return `https://${apiId}.execute-api.${region}.amazonaws.com/${stage}`;
};

/**
 * $connect handler - authenticate and store connection
 */
export const connect = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const connectionId = event.requestContext.connectionId;
  if (!connectionId) {
    return { statusCode: 400, body: 'Missing connection ID' };
  }

  // Extract auth token from query params or headers
  const token =
    event.queryStringParameters?.token ||
    event.headers?.authorization ||
    event.headers?.Authorization;

  if (!token) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  // TODO: Validate token and extract userId/workspaceId
  // For now, we'll store the connection with a placeholder
  const userId = 'anonymous'; // Replace with actual user ID from token
  const workspaceId = 'default'; // Replace with actual workspace ID from token

  const tableName = getTableName();
  const ttl = Math.floor(Date.now() / 1000) + 2 * 60 * 60; // 2 hours TTL

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
 * $disconnect handler - cleanup connection
 */
export const disconnect = async (
  event: APIGatewayProxyEventV2,
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
          SK: 'META',
        },
      }),
    );

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

  // Initialize API Gateway Management client
  const managementApi = new ApiGatewayManagementApiClient({
    endpoint: wsEndpoint,
  });

  try {
    switch (message.action) {
      case 'subscribe': {
        const { entityType, entityId, byEntityType, byEntityId } =
          message.payload;

        if (!entityType || !entityId) {
          return { statusCode: 400, body: 'Missing entityType or entityId' };
        }

        // Store subscription
        const subKey = byEntityType
          ? `${SUB_PREFIX}${byEntityType}#${byEntityId}#${entityType}#${entityId}`
          : `${SUB_PREFIX}${entityType}#${entityId}`;

        await docClient.send(
          new PutCommand({
            TableName: tableName,
            Item: {
              PK: subKey,
              SK: `${CONN_PREFIX}${connectionId}`,
              connectionId,
              entityType,
              entityId,
              byEntityType,
              byEntityId,
              subscriptionType: byEntityType ? 'mutual' : 'entity',
              subscribedAt: new Date().toISOString(),
            },
          }),
        );

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
        const { entityType, entityId, byEntityType, byEntityId } =
          message.payload;

        if (!entityType || !entityId) {
          return { statusCode: 400, body: 'Missing entityType or entityId' };
        }

        // Delete subscription
        const subKey = byEntityType
          ? `${SUB_PREFIX}${byEntityType}#${byEntityId}#${entityType}#${entityId}`
          : `${SUB_PREFIX}${entityType}#${entityId}`;

        await docClient.send(
          new DeleteCommand({
            TableName: tableName,
            Key: {
              PK: subKey,
              SK: `${CONN_PREFIX}${connectionId}`,
            },
          }),
        );

        // Send ack
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

      case 'mutate': {
        // For mutations, we acknowledge receipt but the actual mutation
        // is handled by the HTTP API or through EventBridge
        // This is a placeholder for future implementation
        const ackMessage: ServerMessage = {
          type: 'ack',
          id: message.id,
          payload: { action: 'mutate', success: true },
        };

        await managementApi.send(
          new PostToConnectionCommand({
            ConnectionId: connectionId,
            Data: JSON.stringify(ackMessage),
          }),
        );

        return { statusCode: 200, body: 'Mutation acknowledged' };
      }

      default:
        return { statusCode: 400, body: 'Unknown action' };
    }
  } catch (error) {
    console.error('Error handling message:', error);

    // Send error message
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
      // Ignore errors sending error messages
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
    if (record.eventName === 'INSERT' || record.eventName === 'MODIFY') {
      const newImage = record.dynamodb?.NewImage;
      if (!newImage) continue;

      // Extract entity info from DynamoDB image
      const pk = newImage.PK?.S || '';
      const sk = newImage.SK?.S || '';

      // Only process entity records (not connection or subscription records)
      if (pk.startsWith('CONN#') || pk.startsWith('SUB#')) continue;

      // Parse entity type and ID from PK/SK
      // Monorise format: PK = {entityType}#{entityId}, SK = META for entities
      const pkParts = pk.split('#');
      if (pkParts.length < 2) continue;

      const entityType = pkParts[0];
      const entityId = pkParts[1];

      // Determine if this is an entity or mutual update
      const isMutual = !sk.startsWith('META') && sk.includes('#');

      // Build subscription key
      const subKey = isMutual
        ? `${SUB_PREFIX}${entityType}#${entityId}#${sk.split('#')[0]}#${sk.split('#')[1]}`
        : `${SUB_PREFIX}${entityType}#${entityId}`;

      try {
        // Query for subscribers
        const subscribersResult = await docClient.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: 'PK = :pk',
            ExpressionAttributeValues: {
              ':pk': subKey,
            },
          }),
        );

        if (!subscribersResult.Items?.length) continue;

        // Build message
        const message: ServerMessage = {
          type: isMutual ? 'mutual.update' : 'entity.update',
          id: nanoid(),
          payload: {
            entityType,
            entityId,
            data: newImage,
          },
        };

        const messageData = JSON.stringify(message);

        // Send to all subscribers
        for (const subscriber of subscribersResult.Items) {
          const subscriberConnectionId = subscriber.connectionId as string;

          try {
            await managementApi.send(
              new PostToConnectionCommand({
                ConnectionId: subscriberConnectionId,
                Data: messageData,
              }),
            );
          } catch (error: unknown) {
            // If connection is gone, delete the subscription
            if (
              error instanceof Error &&
              error.message?.includes('GoneException')
            ) {
              await docClient.send(
                new DeleteCommand({
                  TableName: tableName,
                  Key: {
                    PK: subKey,
                    SK: `${CONN_PREFIX}${subscriberConnectionId}`,
                  },
                }),
              );
            }
          }
        }
      } catch (error) {
        console.error('Error broadcasting message:', error);
      }
    }

    // Handle DELETE events
    if (record.eventName === 'REMOVE') {
      const oldImage = record.dynamodb?.OldImage;
      if (!oldImage) continue;

      const pk = oldImage.PK?.S || '';
      const sk = oldImage.SK?.S || '';

      if (pk.startsWith('CONN#') || pk.startsWith('SUB#')) continue;

      const pkParts = pk.split('#');
      if (pkParts.length < 2) continue;

      const entityType = pkParts[0];
      const entityId = pkParts[1];
      const isMutual = !sk.startsWith('META') && sk.includes('#');

      const subKey = isMutual
        ? `${SUB_PREFIX}${entityType}#${entityId}#${sk.split('#')[0]}#${sk.split('#')[1]}`
        : `${SUB_PREFIX}${entityType}#${entityId}`;

      try {
        const subscribersResult = await docClient.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: 'PK = :pk',
            ExpressionAttributeValues: {
              ':pk': subKey,
            },
          }),
        );

        if (!subscribersResult.Items?.length) continue;

        const message: ServerMessage = {
          type: isMutual ? 'mutual.delete' : 'entity.delete',
          id: nanoid(),
          payload: {
            entityType,
            entityId,
          },
        };

        const messageData = JSON.stringify(message);

        for (const subscriber of subscribersResult.Items) {
          const subscriberConnectionId = subscriber.connectionId as string;

          try {
            await managementApi.send(
              new PostToConnectionCommand({
                ConnectionId: subscriberConnectionId,
                Data: messageData,
              }),
            );
          } catch (error: unknown) {
            if (
              error instanceof Error &&
              error.message?.includes('GoneException')
            ) {
              await docClient.send(
                new DeleteCommand({
                  TableName: tableName,
                  Key: {
                    PK: subKey,
                    SK: `${CONN_PREFIX}${subscriberConnectionId}`,
                  },
                }),
              );
            }
          }
        }
      } catch (error) {
        console.error('Error broadcasting delete:', error);
      }
    }
  }
};
