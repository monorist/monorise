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

    // If no feedTypes specified, resolve all reachable entity types from config
    // Traverses the mutual graph transitively: user → channel → message
    if (!feedTypes || feedTypes.length === 0) {
      const allConfigs = this.container.config.EntityConfig;
      const visited = new Set<string>();
      const queue: string[] = [entityType];

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);

        const config = allConfigs[current as any];
        if (config?.mutual?.mutualFields) {
          for (const field of Object.values(config.mutual.mutualFields) as any[]) {
            if (!visited.has(field.entityType)) {
              queue.push(field.entityType);
            }
          }
        }
      }

      // Remove the root entity itself — feedTypes is about related types
      visited.delete(entityType);
      feedTypes = Array.from(visited);
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
