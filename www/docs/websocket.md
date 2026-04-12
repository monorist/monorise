# WebSocket

Monorise includes optional WebSocket support for real-time entity and mutual updates. It follows the same philosophy as the rest of monorise: HTTP for mutations (reliable), WebSocket for live updates (efficient).

::: warning
WebSocket is an optional feature. Your app works fine without it — `useEntities` and `useMutuals` fetch via HTTP. WebSocket adds real-time push on top of that.
:::

## Enabling WebSocket

Add `webSocket: { enabled: true }` to your MonoriseCore config:

```ts
// sst.config.ts
const core = new monorise.module.Core('app', {
  webSocket: { enabled: true },
  allowOrigins: ['http://localhost:3000'],
});
```

This provisions:
- An API Gateway WebSocket API (`$connect`, `$disconnect`, `$default` routes)
- A broadcast Lambda that subscribes to DynamoDB Streams and pushes changes to connected clients
- Connection and subscription records in the existing single table

## Subscription Types

Monorise supports four subscription types, from low-level to high-level:

| Type | Hook | Purpose |
|------|------|---------|
| Entity | `useEntitySocket` | All CRUD events for an entity type |
| Mutual | `useMutualSocket` | Mutual changes for a specific entity pair |
| Ephemeral | `useEphemeralSocket` | Non-persisted messages (typing indicators, presence) |
| Feed | `useEntityFeed` | Graph-aware: all changes relevant to an entity |

### Entity socket

Subscribe to all changes of an entity type. Returns an array, consistent with `useEntities`.

```ts
const { entities, isLoading, isSubscribed, fetchMore, hasMore } =
  useEntitySocket(Entity.CHANNEL);
```

When a channel is created, updated, or deleted anywhere, all subscribers receive the update and the local store is updated automatically.

### Mutual socket

Subscribe to mutual changes for a specific entity pair. Returns an array, consistent with `useMutuals`.

```ts
const { mutuals, isLoading, isSubscribed, fetchMore, hasMore } =
  useMutualSocket(Entity.CHANNEL, channelId, Entity.MESSAGE, { limit: 50 });
```

Fetches messages via HTTP on mount, then receives real-time updates via WebSocket. Auto-refetches on reconnect to fill any gaps.

### Ephemeral socket

Send and receive non-persisted messages on a named channel. Nothing is stored in DynamoDB.

```ts
// Receive
useEphemeralSocket<{ userId: string; type: 'typing' | 'stopped' }>(
  `channel:${channelId}:typing`,
  {
    onMessage: (data, senderId) => {
      // Handle typing indicator
    },
  },
);

// Send
const { send } = useEphemeralSocket<{ userId: string; type: 'typing' }>(
  `channel:${channelId}:typing`,
);
send({ userId: currentUserId, type: 'typing' });
```

Use cases: typing indicators, live cursors, presence, any transient state that doesn't need persistence.

### Entity feed

Subscribe to **everything relevant to an entity** based on the mutual graph. This is the recommended approach for most apps.

```ts
const { isConnected, error } = useEntityFeed({
  entityType: Entity.USER,
  entityId: userId,
});
```

When User A has a mutual with Channel X, and a new message is created in Channel X, User A receives the update automatically. No manual per-channel subscription needed.

The feed hook:
- Fetches a ticket via your proxy (or the default catch-all route)
- Connects to WebSocket with the ticket
- Routes all broadcast events into the entity and mutual stores
- Refreshes the ticket before expiry
- Resyncs via HTTP on reconnect

::: tip
`useEntityFeed` doesn't replace `useEntities` or `useMutuals` — it supplements them. Your existing hooks continue to work exactly as before. The feed just keeps their stores updated in real-time.
:::

## Entity Feed

The entity feed deserves a deeper explanation since it's the primary way to add real-time updates to your app.

### How it works

1. Your app calls `useEntityFeed({ entityType: Entity.USER, entityId: userId })`
2. The hook requests a **ticket** from monorise (via your proxy or the default route)
3. The ticket carries the entity identity and allowed feed types
4. The hook connects to WebSocket with the ticket
5. The `$connect` handler validates the ticket and creates a feed subscription
6. When any change happens in the mutual graph of that entity, the broadcast handler resolves affected feed subscribers and pushes the event

### Default vs custom ticket endpoint

This follows the same pattern as `customUrl` in `useEntities` and `useMutuals`:

**Default (internal apps)** — goes through the catch-all proxy, no auth:

```ts
useEntityFeed({
  entityType: Entity.USER,
  entityId: userId,
});
```

**Custom (client-facing apps)** — your own proxy route with auth:

```ts
useEntityFeed({
  entityType: Entity.USER,
  entityId: userId,
  ticketEndpoint: '/api/ws/ticket',
});
```

### Ticket proxy route

For client-facing apps, create a proxy route that validates auth and issues a ticket:

```ts
// /api/ws/ticket/route.ts
import { generateWebSocketTicket } from 'monorise/proxy';
import { Entity } from './monorise/entities';

export async function POST(req) {
  const session = await getSession(req); // your auth
  const { entityType, entityId } = await req.json();

  // Your authorization logic
  if (entityId !== session.userId) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }

  const ticket = await generateWebSocketTicket({
    entityType,
    entityId,
    feedTypes: [Entity.CHANNEL, Entity.MESSAGE],
  });

  return Response.json(ticket);
}
```

`generateWebSocketTicket()` handles the monorise API call internally. You control auth and which feed types each app gets.

### Per-app feed control

Different apps can issue tickets with different feed types:

```ts
// Client app — limited feed
feedTypes: [Entity.CHANNEL, Entity.MESSAGE]

// Admin app — full feed
feedTypes: [Entity.CHANNEL, Entity.MESSAGE, Entity.AUDIT_LOG, Entity.PAYMENT]
```

The ticket carries the whitelist. The broadcast handler only pushes events for entity types in the whitelist.

### Connection status

```ts
const { isConnected, error } = useEntityFeed({ ... });

// isConnected: true when WebSocket is open
// error?.code: 'TICKET_UNAUTHORIZED' | 'TICKET_FAILED' | 'CONNECTION_FAILED'
```

### Ticket refresh

Tickets expire after 30 minutes. The hook refreshes proactively (2 minutes before expiry). If the proactive refresh fails, the server closes the connection on expiry and the hook reconnects with a fresh ticket.

The developer never manages refresh. If the user's auth session expires, the proxy returns 401 and `error.code` becomes `'TICKET_UNAUTHORIZED'` — show a login screen.

## DynamoDB Schema

All WebSocket records live in the same single table as entities and mutuals, using consistent conventions:

| Record | PK | SK |
|--------|----|----|
| Connection | `CONN#{connectionId}` | `#METADATA#` |
| Ticket | `TICKET#{ticketId}` | `#METADATA#` |
| Entity subscription | `SUB#ENTITY#{entityType}` | `CONN#{connectionId}` |
| Mutual subscription | `SUB#MUTUAL#{byEntityType}#{byEntityId}#{entityType}` | `CONN#{connectionId}` |
| Ephemeral subscription | `SUB#EPHEMERAL#{channel}` | `CONN#{connectionId}` |
| Feed subscription | `SUB#FEED#{entityType}#{entityId}` | `CONN#{connectionId}` |

All subscription records set `R1PK = CONN#{connectionId}` for reverse lookup on disconnect. Tickets use DynamoDB TTL (`expiresAt`) for automatic cleanup.

## Connection Cleanup

Three-layer strategy:

1. **`$disconnect` handler** — queries R1 GSI by connectionId, deletes all subscription records in parallel
2. **GoneException handling** — when broadcasting to a dead connection, the stale subscription record is deleted immediately
3. **DynamoDB TTL** — connection and ticket records have `expiresAt` as a safety net for orphaned records

## Architecture

```
Browser                     AWS
───────                     ───

useEntityFeed()
  │
  ├─ POST /api/.../ws/ticket ──► Hono Lambda ──► DynamoDB (TICKET#)
  │  ◄── { ticket, wsUrl }
  │
  ├─ wss://wsUrl?ticket=... ──► API GW WebSocket
  │                               │
  │                               ├─ $connect ──► validate ticket
  │                               │               create CONN# + SUB#FEED#
  │                               │
  │                               ├─ $default ──► route subscribe/ephemeral
  │                               │
  │                               └─ $disconnect ──► cleanup via R1 GSI
  │
  │  DynamoDB Stream ──► broadcast Lambda
  │                        │
  │                        ├─ entity change? ──► query SUB#ENTITY# subscribers
  │                        ├─ mutual change? ──► query SUB#MUTUAL# subscribers
  │                        └─ any change? ──► resolve SUB#FEED# via mutual graph
  │
  ◄── { type: 'entity.created', payload: ... }
       (auto-updates zustand store)
```

## Example: Chat App

A full working chat application demonstrates the WebSocket features end-to-end.

**[Live demo](https://d1n9mvjkvdjtz1.cloudfront.net/)** · **[Source code](https://github.com/monorist/monorise/tree/main/examples/websocket-chat)**

### What it demonstrates

- **Entity feed** — `useEntityFeed` provides real-time updates across all joined channels with a single hook
- **Channel membership** — users join channels via mutuals; sidebar separates "Joined" and "Browse" sections
- **Unread messages** — `lastReadAt` stored as mutual data between user and channel, unread count badge in the sidebar, "New" divider in the conversation view
- **Typing indicators** — `useEphemeralSocket` for non-persisted real-time events
- **Connection recovery** — automatic reconnect after network drops and sleep/wake

### Key patterns

#### Setting up the feed

```tsx
function ChatApp({ currentUserId }) {
  const { isConnected, error } = useEntityFeed({
    entityType: Entity.USER,
    entityId: currentUserId,
  });

  // Existing hooks automatically reflect real-time changes
  const { mutuals: joinedChannels } = useMutuals(
    Entity.USER, Entity.CHANNEL, currentUserId,
  );
}
```

#### Tracking unread messages

Store a `lastReadAt` timestamp as mutual data between user and channel. When the user views a channel, update it:

```tsx
// Mark channel as read
editMutual(Entity.USER, Entity.CHANNEL, userId, channelId, {
  lastReadAt: new Date().toISOString(),
});
```

Count unread messages by listening for incoming feed messages on non-active channels:

```tsx
const ws = getWebSocketManager();
ws.onMessage((msg) => {
  if (msg.type !== 'mutual.created') return;
  const { byEntityType, mutualEntityType, byEntityId } = msg.payload;
  if (byEntityType !== 'channel' || mutualEntityType !== 'message') return;
  if (byEntityId === selectedChannelId) return; // skip active channel
  // increment unread count for byEntityId
});
```

#### Typing indicators

```tsx
// Send
const { send } = useEphemeralSocket(`channel:${channelId}:typing`);
send({ type: 'typing', userId, userName });

// Receive
useEphemeralSocket(`channel:${channelId}:typing`, {
  onMessage: (data) => {
    // show typing indicator for data.userName
  },
});
```
