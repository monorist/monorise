import type { Entity } from '#/monorise';
import { generateWebSocketTicket } from 'monorise/proxy';

// Issues a WebSocket ticket for any entity, with no user check. Fine for
// local development. Before real users sign in, check here that the session
// may follow this entity:
// https://monorise.dev/websocket#ticket-proxy-route
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ entityType: string; entityId: string }> },
) {
  const { entityType, entityId } = await params;
  const ticket = await generateWebSocketTicket({
    entityType: entityType as Entity,
    entityId,
  });
  return Response.json(ticket);
}
