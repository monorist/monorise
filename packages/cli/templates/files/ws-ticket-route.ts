import { Entity } from '#/monorise';
import { generateWebSocketTicket } from 'monorise/proxy';

// Issues a WebSocket ticket for any entity of a known type, with no user
// check. Fine for local development. Before real users sign in, check here
// that the session may follow this entity:
// https://monorise.dev/websocket#ticket-proxy-route
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ entityType: string; entityId: string }> },
) {
  const { entityType, entityId } = await params;
  if (!(Object.values(Entity) as string[]).includes(entityType)) {
    return Response.json({ code: 'NOT_FOUND' }, { status: 404 });
  }
  const ticket = await generateWebSocketTicket({
    entityType: entityType as Entity,
    entityId,
  });
  return Response.json(ticket);
}
