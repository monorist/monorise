# Design: Entity Feed (Real-time WebSocket Subscriptions)

## Problem

Monorise's current WebSocket hooks (`useEntitySocket`, `useMutualSocket`) are **topic-based** -- the client explicitly subscribes to each entity type or mutual relationship it cares about. This works for small numbers of subscriptions but doesn't scale when an entity has many relationships (e.g., a user in 50 channels).

Slack-like apps need a different model: "push me everything relevant to this entity" -- without the frontend developer manually wiring up subscriptions for each relationship.

## Goals

- **Graph-aware subscriptions**: Subscribe once to an entity's feed, receive updates for all connected entities/mutuals based on the relationship graph
- **Auth-agnostic**: Monorise doesn't own auth. Developers bring their own auth solution (OpenAuth, NextAuth, etc.)
- **Consistent DX**: Same mental model as existing monorise hooks -- auto-cache management, auto-resync on reconnect, works through catch-all proxy by default
- **Per-app feed control**: Admin app and client app can subscribe to different feed types for the same entity
- **No infrastructure leaks**: Developers never deal with connectionIds, DynamoDB subscriptions, or WebSocket internals

## Design

### Architecture Overview

```
Client                    Developer's Proxy              Monorise
------                    ----------------              --------
                          (Next.js API / Lambda)

useEntityFeed()
  |
  |--> POST /api/ws/ticket             (custom ticketEndpoint)
  |    OR
  |    POST /api/proxy/.../ws/ticket   (default, catch-all proxy)
  |
  |    (developer's route)  --> validates auth (if custom)
  |                         --> calls generateWebSocketTicket()
  |                              |
  |                              |--> POST /ws/ticket/:entityType/:entityId
  |                              |    (monorise Hono route)
  |                              |    creates ticket in DynamoDB
  |                              |    returns { ticket, wsUrl, expiresIn }
  |    <-- { ticket, wsUrl, expiresIn }
  |
  |--> wss://wsUrl?ticket=abc123
  |    ($connect handler)                   --> validates ticket
  |                                         --> reads entityType, entityId, feedTypes
  |                                         --> creates connection record
  |                                         --> auto-subscribes to feeds
  |                                         --> deletes ticket (one-time use)
  |
  |<-- broadcasts flow automatically
  |    (store updates, components re-render)
```

### Default vs Custom Ticket Endpoint

Follows the same pattern as `useEntities` / `useMutuals` with `customUrl`:

#### Default (no `ticketEndpoint`) -- internal apps, fast setup

Monorise's Hono app exposes a built-in route:

```
POST /ws/ticket/:entityType/:entityId
```

Returns a ticket with **all** feed types for that entity (everything in the mutual graph). No auth, goes through the existing catch-all proxy. Internal apps just work:

```tsx
useEntityFeed({
  entityType: Entity.USER,
  entityId: userId,
});
```

Zero extra setup. Same as how `useEntities(Entity.CHANNEL)` works without `customUrl`.

#### Custom (`ticketEndpoint`) -- client-facing apps, auth required

Developer provides their own proxy endpoint that adds auth and restricts feed types:

```tsx
useEntityFeed({
  entityType: Entity.USER,
  entityId: userId,
  ticketEndpoint: '/api/ws/ticket',
});
```

The hook sends `POST /api/ws/ticket` with `{ entityType, entityId }` in the body. The developer's route validates auth, decides feed types, and calls `generateWebSocketTicket()`.

This mirrors `customUrl` in `useEntities` / `useMutuals` -- same mental model, no surprises.

### Ticket-based Auth Flow

The ticket pattern separates auth from WebSocket connection:

1. **Developer's proxy route** validates their own auth (session, JWT, whatever they use)
2. Proxy calls `generateWebSocketTicket()` -- a monorise-provided helper -- to create a short-lived ticket
3. Client connects to WebSocket with the ticket
4. `$connect` handler validates the ticket and sets up subscriptions
5. Ticket is single-use and expires if unused (DynamoDB TTL)

This keeps monorise auth-free while giving developers full control over who connects and what they see.

### Per-app Feed Control

Different apps issue tickets with different feed types through their own proxy routes:

```ts
// Client app proxy: /api/ws/ticket
import { generateWebSocketTicket } from 'monorise/proxy';
import { Entity } from './monorise/entities';

export async function POST(req) {
  const session = await getSession(req);
  const { entityType, entityId } = await req.json();

  // Developer's auth: validate ownership
  if (entityId !== session.userId) return forbidden();

  const ticket = await generateWebSocketTicket({
    entityType,
    entityId,
    feedTypes: [Entity.CHANNEL, Entity.MESSAGE],
  });

  return Response.json(ticket);
}
```

```ts
// Admin app proxy: /api/ws/ticket
export async function POST(req) {
  const session = await getAdminSession(req);
  const { entityType, entityId } = await req.json();

  const ticket = await generateWebSocketTicket({
    entityType,
    entityId,
    feedTypes: [Entity.CHANNEL, Entity.MESSAGE, Entity.AUDIT_LOG, Entity.PAYMENT],
  });

  return Response.json(ticket);
}
```

Same monorise infrastructure, different feed scopes per app. The developer decides what each app gets.

### Default Route -- All Feed Types

For internal apps using the default route (no `ticketEndpoint`), the built-in Hono route returns a ticket with all mutual types related to the entity. This is equivalent to the catch-all proxy pattern for REST -- it works out of the box, no auth, suitable for internal tools.

For production client-facing apps, the developer should always use `ticketEndpoint` with their own auth, just as they'd use `customUrl` for REST endpoints.

### Developer API

#### React Hook

```tsx
// Internal app -- zero config, uses catch-all proxy
const { isConnected, error } = useEntityFeed({
  entityType: Entity.USER,
  entityId: userId,
});

// Client-facing app -- custom auth endpoint
const { isConnected, error } = useEntityFeed({
  entityType: Entity.USER,
  entityId: userId,
  ticketEndpoint: '/api/ws/ticket',
});

// error.code === 'TICKET_UNAUTHORIZED' --> developer shows login screen
```

The hook:
- Fetches a ticket (through `ticketEndpoint` or default monorise route via catch-all proxy)
- Sends `{ entityType, entityId }` in the ticket request body
- Manages the WebSocket connection lifecycle
- Auto-updates entity/mutual stores so existing hooks reflect real-time changes
- Handles ticket refresh transparently
- Resyncs data on reconnect

`entityType` and `entityId` are required because:
- They're sent to the ticket endpoint as request context
- They're needed for auto-resync on reconnect (to know which relationships to refetch)
- They're needed for store routing (to know which store keys to update)

#### Server Helper

```ts
import { generateWebSocketTicket } from 'monorise/proxy';
import { Entity } from './monorise/entities';

const ticket = await generateWebSocketTicket({
  entityType: Entity.USER,
  entityId: '456',
  feedTypes: [Entity.CHANNEL, Entity.MESSAGE],
});

// Returns: { ticket: string, wsUrl: string, expiresIn: number }
```

The helper handles monorise API URL, API key, and request format internally. Developer never sees `/ws/ticket` or constructs fetch calls manually. Lives in `monorise/proxy` alongside other proxy-layer helpers.

### Store Integration

`useEntityFeed` does NOT expose raw events. It silently routes broadcasts into existing stores:

- `mutual.created` for `channel:A / message:xyz` --> updates `state.mutual['channel/A/message']`
- `entity.updated` for `channel:A` --> updates `state.entity['channel']`
- `entity.deleted` for `channel:B` --> removes from `state.entity['channel']`

Existing hooks (`useMutuals`, `useEntities`, `useMutualSocket`, `useEntitySocket`) automatically reflect these updates. The developer doesn't learn a new API for consuming feed data.

### Ticket Refresh

**Strategy: proactive refresh with reactive fallback.**

#### Proactive (primary)
1. Hook tracks `expiresIn` from ticket response
2. Sets a timer for `expiresIn - 2 minutes`
3. Timer fires --> calls ticket endpoint for a new ticket
4. Opens new WebSocket with new ticket
5. Once new connection is confirmed --> closes old connection
6. Brief overlap, no gap in events

#### Reactive (fallback)
1. If proactive refresh fails (network blip, proxy error), server closes connection on ticket expiry
2. `WebSocketManager` reconnect logic detects the close
3. Triggers fresh ticket fetch
4. If proxy returns 401 (user's auth session expired) --> surfaces `TICKET_UNAUTHORIZED` error
5. If proxy returns new ticket --> reconnects

Either path, the developer doesn't manage refresh. They only react to `error` if their auth dies.

### Auto-resync on Reconnect

Same pattern as `useEntitySocket` / `useMutualSocket`:

1. Connection drops (network, ticket expiry, server restart)
2. Hook fetches new ticket --> reconnects
3. Once connected, for each feed type:
   - Refetch entities/mutuals via HTTP to fill the gap
   - Resubscribe to feeds server-side
4. Store updates with fresh data --> components re-render

No events are permanently lost. The gap between disconnect and reconnect is covered by the HTTP refetch.

### Server-side: Feed Broadcast Resolution

When the broadcast handler processes a DynamoDB stream event:

1. Parse the event (entity change or mutual change)
2. For a mutual change (e.g., new message in channel A):
   - `byEntityType: channel`, `byEntityId: A`
   - Query: which feed subscribers are connected to channel A?
   - This means: find entities that have a mutual with channel A (users in channel A)
   - Push to those entities' connections
3. For an entity change (e.g., channel A updated):
   - Query: which feed subscribers include `channel` in their feed types and are connected to channel A?
   - Push to those connections

### Connection Cleanup

Three-layer cleanup strategy:

1. **`$disconnect` handler** (primary): Delete connection and all subscription records for the disconnected connectionId
2. **`GoneException` handling** (self-healing): When `PostToConnection` fails with 410, delete that subscription record immediately
3. **DynamoDB TTL** (safety net): Connection records have generous TTL (24h+) to sweep orphans that escaped both cleanup paths

## Implementation Plan

### Phase 1: Ticket System
- [ ] `POST /ws/ticket/:entityType/:entityId` Hono route -- creates ticket in DynamoDB with TTL, default feedTypes = all mutual types for entity
- [ ] `generateWebSocketTicket()` helper in `monorise/proxy`
- [ ] Update `$connect` handler to accept ticket (in addition to existing token), validate, extract permissions
- [ ] Ticket DynamoDB schema: `PK: TICKET#abc | feedEntityType | feedEntityId | feedTypes | expiresAt`

### Phase 2: Feed Subscriptions
- [ ] New subscription type: `SUB:FEED:user:456` -- stores connectionId + allowed feed types
- [ ] Broadcast resolver: on stream event, resolve affected feed subscribers via mutual graph traversal
- [ ] `ConsistentRead: true` on broadcast subscriber queries

### Phase 3: React Hook
- [ ] `useEntityFeed` hook -- ticket fetch (default route or custom `ticketEndpoint`), WebSocket connection, store routing
- [ ] Sends `{ entityType, entityId }` to ticket endpoint
- [ ] Proactive ticket refresh with reactive fallback
- [ ] Auto-resync on reconnect (HTTP refetch for each feed type using entityType/entityId)
- [ ] Error states: `TICKET_UNAUTHORIZED`, `TICKET_EXPIRED`, `CONNECTION_FAILED`

### Phase 4: Connection Cleanup
- [ ] `$disconnect` handler: delete subscription records (not just connection record)
- [ ] `broadcastToSubscribers`: delete stale subscription on `GoneException`
- [ ] TTL on connection + subscription records as safety net

## Open Questions

- **Feed resolution cost**: Traversing the mutual graph per broadcast event could be expensive at scale. Should we denormalize (maintain a "who cares about channel A" index) or is the query acceptable?
- **Stale feed types**: If the developer changes feed types in their proxy (removes `Entity.PAYMENT`), existing connections still have the old ticket. Should the server re-validate feed types periodically, or just let ticket refresh handle it?
- **Multiple `useEntityFeed` calls**: Should multiple hooks share one WebSocket connection (merge feed types) or is one feed per app sufficient?
