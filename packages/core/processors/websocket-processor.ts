import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type {
  APIGatewayProxyResultV2,
  APIGatewayProxyWebsocketEventV2,
  DynamoDBStreamEvent,
  DynamoDBStreamHandler,
} from 'aws-lambda';
import { ulid } from 'ulid';
import type {
  SubscriptionRecord,
  WebSocketRepository,
} from '../data/WebSocket';
import type { DependencyContainer } from '../services/DependencyContainer';

// $connect event includes query params and headers, but the base WebSocket type doesn't model them
type WebSocketConnectEvent = APIGatewayProxyWebsocketEventV2 & {
  queryStringParameters?: Record<string, string | undefined>;
  headers?: Record<string, string | undefined>;
};

const CONN_PREFIX = 'CONN#';
// Subscription keys
const SUB_ENTITY_TYPE = 'SUB#ENTITY#'; // SUB#ENTITY#{entityType}
const SUB_MUTUAL_TYPE = 'SUB#MUTUAL#'; // SUB#MUTUAL#{byEntityType}#{byEntityId}#{entityType}
const SUB_EPHEMERAL = 'SUB#EPHEMERAL#'; // SUB#EPHEMERAL#{channel}
const SUB_FEED = 'SUB#FEED#'; // SUB#FEED#{entityType}#{entityId}

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

const getWsEndpoint = () => process.env.WEBSOCKET_MANAGEMENT_ENDPOINT || '';

/**
 * $connect handler
 * Supports two auth modes:
 * - ticket: ?ticket=abc123 (issued via /ws/ticket/:entityType/:entityId)
 * - token: ?token=userId (simplified direct auth)
 */
export const connect =
  (container: DependencyContainer) =>
  async (event: WebSocketConnectEvent): Promise<APIGatewayProxyResultV2> => {
    const connectionId = event.requestContext.connectionId;
    if (!connectionId) {
      return { statusCode: 400, body: 'Missing connection ID' };
    }

    const expiresAt = Math.floor(Date.now() / 1000) + 2 * 60 * 60;

    const ticket = event.queryStringParameters?.ticket;
    const token =
      event.queryStringParameters?.token ||
      event.headers?.authorization ||
      event.headers?.Authorization;

    if (!ticket && !token) {
      return { statusCode: 401, body: 'Unauthorized' };
    }

    const wsRepo = container.websocketRepository;

    try {
      let entityType: string | undefined;
      let entityId: string | undefined;
      let feedTypes: string[] | undefined;

      if (ticket) {
        // Ticket-based auth (entity feed)
        const ticketData = await wsRepo.consumeTicket(ticket);
        if (!ticketData) {
          return { statusCode: 401, body: 'Invalid or expired ticket' };
        }
        entityType = ticketData.entityType;
        entityId = ticketData.entityId;
        feedTypes = ticketData.feedTypes;
      } else {
        // Token-based auth (simple/direct) — token is treated as entityId
        entityId = token as string;
      }

      // Store connection record
      await wsRepo.createConnection(
        connectionId,
        {
          ...(entityType && { entityType }),
          ...(entityId && { entityId }),
          connectedAt: new Date().toISOString(),
        },
        expiresAt,
      );

      // If ticket-based, auto-subscribe to feed
      if (entityType && entityId && feedTypes) {
        await wsRepo.createSubscription(
          `${SUB_FEED}${entityType}#${entityId}`,
          connectionId,
          {
            subscriptionType: 'feed',
            entityType,
            entityId,
            feedTypes,
            subscribedAt: new Date().toISOString(),
            expiresAt,
          },
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
 * Cleans up connection record and all associated subscription records.
 */
export const disconnect =
  (container: DependencyContainer) =>
  async (
    event: APIGatewayProxyWebsocketEventV2,
  ): Promise<APIGatewayProxyResultV2> => {
    const connectionId = event.requestContext.connectionId;
    if (!connectionId) {
      return { statusCode: 400, body: 'Missing connection ID' };
    }

    const wsRepo = container.websocketRepository;

    try {
      // Query R1 GSI to find all subscription records for this connection
      const subscriptions =
        await wsRepo.querySubscriptionsByConnectionId(connectionId);

      const deletePromises: Promise<unknown>[] = [];

      // Delete all subscription records found via R1 GSI
      for (const item of subscriptions) {
        if (item.PK && item.SK) {
          deletePromises.push(
            wsRepo
              .deleteSubscription(item.PK, item.connectionId)
              .catch((e) =>
                console.warn('Failed to delete subscription on disconnect:', e),
              ),
          );
        }
      }

      // Delete connection record
      deletePromises.push(wsRepo.deleteConnection(connectionId));

      await Promise.all(deletePromises);

      return { statusCode: 200, body: 'Disconnected' };
    } catch (error) {
      console.error('Error cleaning up connection:', error);
      return { statusCode: 500, body: 'Failed to disconnect' };
    }
  };

/**
 * $default handler - route messages
 */
export const $default =
  (container: DependencyContainer) =>
  async (
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

    const wsRepo = container.websocketRepository;
    const wsEndpoint = getWsEndpoint();
    const managementApi = new ApiGatewayManagementApiClient({
      endpoint: wsEndpoint,
    });

    try {
      switch (message.action) {
        case 'subscribe': {
          const {
            entityType,
            byEntityType,
            byEntityId,
            mutualEntityType,
            channel,
          } = message.payload;

          // Entity type subscription
          if (entityType && !byEntityType) {
            await wsRepo.createSubscription(
              `${SUB_ENTITY_TYPE}${entityType}`,
              connectionId,
              {
                subscriptionType: 'entity-type',
                entityType,
                subscribedAt: new Date().toISOString(),
              },
            );
          }
          // Mutual type subscription
          else if (byEntityType && byEntityId && mutualEntityType) {
            await wsRepo.createSubscription(
              `${SUB_MUTUAL_TYPE}${byEntityType}#${byEntityId}#${mutualEntityType}`,
              connectionId,
              {
                subscriptionType: 'mutual-type',
                byEntityType,
                byEntityId,
                entityType: mutualEntityType,
                subscribedAt: new Date().toISOString(),
              },
            );
          }
          // Ephemeral channel subscription
          else if (channel) {
            await wsRepo.createSubscription(
              `${SUB_EPHEMERAL}${channel}`,
              connectionId,
              {
                subscriptionType: 'ephemeral',
                channel,
                subscribedAt: new Date().toISOString(),
              },
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
          const {
            entityType,
            byEntityType,
            byEntityId,
            mutualEntityType,
            channel,
          } = message.payload;

          if (entityType && !byEntityType) {
            await wsRepo.deleteSubscription(
              `${SUB_ENTITY_TYPE}${entityType}`,
              connectionId,
            );
          } else if (byEntityType && byEntityId && mutualEntityType) {
            await wsRepo.deleteSubscription(
              `${SUB_MUTUAL_TYPE}${byEntityType}#${byEntityId}#${mutualEntityType}`,
              connectionId,
            );
          } else if (channel) {
            await wsRepo.deleteSubscription(
              `${SUB_EPHEMERAL}${channel}`,
              connectionId,
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
          const conn = await wsRepo.getConnection(connectionId);
          const senderId = conn?.entityId;

          // Broadcast to all subscribers of this channel
          const subKey = `${SUB_EPHEMERAL}${channel}`;
          const ephemeralMessage: ServerMessage = {
            type: 'ephemeral',
            id: ulid(),
            payload: { channel, data, senderId },
          };

          await broadcastToSubscribers(
            managementApi,
            wsRepo,
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
export const broadcast =
  (container: DependencyContainer) =>
  async (event: DynamoDBStreamEvent): Promise<void> => {
    const wsRepo = container.websocketRepository;
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

      // Only process entity/mutual records (format: entityType#entityId)
      // Skip all other record types (CONN#, SUB#, TICKET#, LIST#, MUTUAL#, etc.)
      const pkParts = pk.split('#');
      if (pkParts.length < 2) continue;
      const firstPart = pkParts[0];
      if (firstPart === firstPart.toUpperCase() || firstPart.includes(':')) {
        continue;
      }

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
          const subscribers = await wsRepo.querySubscriptionsByKey(subKey);

          if (subscribers.length) {
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
                data: isRemove
                  ? undefined
                  : unmarshall(image as Record<string, any>),
              },
            };

            await broadcastToSubscribers(
              managementApi,
              wsRepo,
              subKey,
              message,
            );
          }
        } else {
          // Entity type broadcast
          const subKey = `${SUB_ENTITY_TYPE}${entityType}`;
          const subscribers = await wsRepo.querySubscriptionsByKey(subKey);

          if (subscribers.length) {
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
                data: isRemove
                  ? undefined
                  : unmarshall(image as Record<string, any>),
              },
            };

            await broadcastToSubscribers(
              managementApi,
              wsRepo,
              subKey,
              message,
            );
          }
        }
        // Feed broadcast: resolve feed subscribers connected to this entity
        await broadcastToFeedSubscribers(
          managementApi,
          wsRepo,
          entityType,
          entityId,
          isMutual ? sk.split('#')[0] : entityType, // the changed entity type
          isMutual
            ? {
                type: (isInsert
                  ? 'mutual.created'
                  : isModify
                    ? 'mutual.updated'
                    : 'mutual.deleted') as ServerMessage['type'],
                id: ulid(),
                payload: {
                  byEntityType: entityType,
                  byEntityId: entityId,
                  mutualEntityType: sk.split('#')[0],
                  entityId: sk.split('#')[1],
                  data: isRemove
                    ? undefined
                    : unmarshall(image as Record<string, any>),
                },
              }
            : {
                type: (isInsert
                  ? 'entity.created'
                  : isModify
                    ? 'entity.updated'
                    : 'entity.deleted') as ServerMessage['type'],
                id: ulid(),
                payload: {
                  entityType,
                  entityId,
                  data: isRemove
                    ? undefined
                    : unmarshall(image as Record<string, any>),
                },
              },
        );
      } catch (error) {
        console.error('Error broadcasting:', error);
      }
    }
  };

async function broadcastToSubscribers(
  managementApi: ApiGatewayManagementApiClient,
  wsRepo: WebSocketRepository,
  subKey: string,
  message: ServerMessage,
  excludeConnectionId?: string,
): Promise<void> {
  const subscribers = await wsRepo.querySubscriptionsByKey(subKey);

  if (!subscribers.length) return;

  const messageData = JSON.stringify(message);

  const sends = subscribers
    .filter((subscriber) => {
      const id = subscriber.connectionId;
      return !excludeConnectionId || id !== excludeConnectionId;
    })
    .map(async (subscriber) => {
      try {
        await managementApi.send(
          new PostToConnectionCommand({
            ConnectionId: subscriber.connectionId,
            Data: messageData,
          }),
        );
      } catch (error: unknown) {
        const isGone =
          (error as { name?: string })?.name === 'GoneException' ||
          (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
            ?.httpStatusCode === 410;
        if (isGone) {
          await wsRepo
            .deleteSubscription(subKey, subscriber.connectionId)
            .catch((e) =>
              console.warn('Failed to clean up stale subscription:', e),
            );
        }
      }
    });

  await Promise.allSettled(sends);
}

/**
 * Resolve feed subscribers affected by a change to entityType:entityId.
 *
 * For a mutual change in channel:A, we need to find all entities (e.g., users)
 * that have a mutual relationship with channel:A, then check if they have
 * a feed subscription that includes the changed entity type.
 *
 * For an entity change to channel:A, we check if any feed subscriber
 * directly has channel:A as their feed entity.
 */
async function broadcastToFeedSubscribers(
  managementApi: ApiGatewayManagementApiClient,
  wsRepo: WebSocketRepository,
  byEntityType: string,
  byEntityId: string,
  changedEntityType: string,
  message: ServerMessage,
): Promise<void> {
  // Step 1: Find all entities connected to byEntityType:byEntityId via mutuals
  const connections = await wsRepo.queryMutualConnections(
    byEntityType,
    byEntityId,
  );

  if (!connections.length) return;

  // Also check the entity itself as a feed subscriber
  const connectedEntities = new Set(
    connections.map((c) => `${c.entityType}:${c.entityId}`),
  );
  connectedEntities.add(`${byEntityType}:${byEntityId}`);

  // Step 2: For each connected entity, check if they have a feed subscription
  const sentConnections = new Set<string>();

  for (const connEntity of connectedEntities) {
    const [entityType, entityId] = connEntity.split(':');
    const feedSubs = await wsRepo.queryFeedSubscriptions(entityType, entityId);

    if (!feedSubs.length) continue;

    for (const feedSub of feedSubs) {
      const feedTypes = feedSub.feedTypes;
      const connectionId = feedSub.connectionId;

      // Check if the changed entity type is in the feed's allowed types
      if (feedTypes && !feedTypes.includes(changedEntityType)) continue;

      // Avoid sending duplicate messages to the same connection
      if (sentConnections.has(connectionId)) continue;
      sentConnections.add(connectionId);

      try {
        await managementApi.send(
          new PostToConnectionCommand({
            ConnectionId: connectionId,
            Data: JSON.stringify(message),
          }),
        );
      } catch (error: unknown) {
        const isGone =
          (error as { name?: string })?.name === 'GoneException' ||
          (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
            ?.httpStatusCode === 410;
        if (isGone) {
          await wsRepo
            .deleteSubscription(
              `SUB#FEED#${entityType}#${entityId}`,
              connectionId,
            )
            .catch((e) =>
              console.warn('Failed to clean up stale feed subscription:', e),
            );
        }
      }
    }
  }
}
