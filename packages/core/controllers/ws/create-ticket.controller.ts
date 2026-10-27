import { createMiddleware } from 'hono/factory';
import { ulid } from 'ulid';
import type { DependencyContainer } from '../../services/DependencyContainer';

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
    //
    // The walk is UNDIRECTED. `mutualFields` is not guaranteed symmetric -- a
    // config may declare the edge on only one side -- and following it forward
    // only would miss exactly the case that makes this whole resolution
    // necessary: a type whose edge is declared on the far side is still a type
    // whose changes fan out to this subject, and omitting it produces a socket
    // that connects and then delivers silence for that type.
    if (!feedTypes || feedTypes.length === 0) {
      const allConfigs = this.container.config.EntityConfig;

      // Adjacency in both directions, built once from the whole config.
      const adjacency = new Map<string, Set<string>>();
      const link = (from: string, to: string) => {
        if (!adjacency.has(from)) adjacency.set(from, new Set());
        adjacency.get(from)?.add(to);
      };

      for (const [type, config] of Object.entries(allConfigs) as [
        string,
        { mutual?: { mutualFields?: Record<string, { entityType: string }> } },
      ][]) {
        const fields = config?.mutual?.mutualFields;
        if (!fields) continue;
        for (const field of Object.values(fields)) {
          link(type, field.entityType);
          link(field.entityType, type);
        }
      }

      const visited = new Set<string>();
      const queue: string[] = [entityType];

      while (queue.length > 0) {
        const current = queue.shift();
        if (!current) continue;
        if (visited.has(current)) continue;
        visited.add(current);

        for (const neighbour of adjacency.get(current) ?? []) {
          if (!visited.has(neighbour)) queue.push(neighbour);
        }
      }

      // Remove the root entity itself — feedTypes is about related types
      visited.delete(entityType);
      feedTypes = Array.from(visited);
    }

    const ticket = ulid();
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + TICKET_TTL_SECONDS;

    await this.container.websocketRepository.createTicket(
      ticket,
      entityType,
      entityId,
      feedTypes,
      expiresAt,
    );

    const wsEndpoint = process.env.WEBSOCKET_URL || '';

    return c.json({
      ticket,
      wsUrl: wsEndpoint,
      expiresIn: TICKET_TTL_SECONDS,
    });
  });
}
