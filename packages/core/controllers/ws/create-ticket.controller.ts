import { DynamoDB } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { createMiddleware } from 'hono/factory';
import { ulid } from 'ulid';
import { CORE_TABLE } from '../../configs/service.config';
import type { DependencyContainer } from '../../services/DependencyContainer';

const TICKET_PREFIX = 'TICKET#';
const METADATA_SK = '#METADATA#';
const TICKET_TTL_SECONDS = 30 * 60; // 30 minutes

export class CreateTicketController {
  constructor(private container: DependencyContainer) {}

  controller = createMiddleware(async (c) => {
    const { entityType, entityId } = c.req.param() as {
      entityType: string;
      entityId: string;
    };

    let feedTypes: string[] | undefined;
    try {
      const body = await c.req.json();
      feedTypes = body.feedTypes;
    } catch {
      // No body or invalid JSON — use default (all mutual types)
    }

    // If no feedTypes specified, resolve all mutual types from entity config
    if (!feedTypes || feedTypes.length === 0) {
      const entityConfig = this.container.config.EntityConfig[entityType as any];
      if (entityConfig?.mutual?.mutualFields) {
        feedTypes = Object.values(entityConfig.mutual.mutualFields).map(
          (field: any) => field.entityType,
        );
      } else {
        feedTypes = [];
      }
    }

    const ticket = ulid();
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + TICKET_TTL_SECONDS;

    const tableName = this.container.config.tableName || CORE_TABLE;
    const dynamodbClient = new DynamoDB({});

    await dynamodbClient.putItem({
      TableName: tableName,
      Item: marshall({
        PK: `${TICKET_PREFIX}${ticket}`,
        SK: METADATA_SK,
        entityType,
        entityId,
        feedTypes,
        createdAt: new Date().toISOString(),
        expiresAt,
      }),
    });

    const wsEndpoint = process.env.WEBSOCKET_URL || '';

    return c.json({
      ticket,
      wsUrl: wsEndpoint,
      expiresIn: TICKET_TTL_SECONDS,
    });
  });
}
