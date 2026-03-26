# WebSocket / Real-time

Monorise provides built-in WebSocket support for real-time updates and ephemeral messaging. This enables live collaboration features like typing indicators, live cursors, and instant data synchronization across clients.

## Overview

**Philosophy**: HTTP for mutations (reliable) + WebSocket for real-time updates (scalable)

| Feature | Use | Persistence |
|---------|-----|-------------|
| `useEntitySocket` | Real-time entity updates | ✅ Persisted to DB |
| `useMutualSocket` | Real-time mutual relationship updates | ✅ Persisted to DB |
| `useEphemeralSocket` | Typing indicators, live cursors, presence | ❌ Not persisted |

## Setup

### 1. Enable WebSocket in SST Config

```ts
const core = new monorise.module.Core('app', {
  webSocket: { enabled: true }
})
```

### 2. Initialize WebSocket in Your App

```ts
import { WebSocketManager } from '@monorise/react'
import { initializeWebSocketManager } from '@monorise/react'

// Initialize once at app startup
const wsManager = initializeWebSocketManager(
  WebSocketManager,
  'wss://your-api.execute-api.region.amazonaws.com/stage',
  authToken // Optional: for connection authentication
)
```

## Hooks

### `useEntitySocket`

Subscribe to real-time updates for an entity type. Combines initial HTTP fetch with WebSocket real-time updates.

```ts
const {
  entities,        // Map<string, CreatedEntity<T>>
  isLoading,       // Initial fetch in progress
  isFetchingMore,  // Loading more pages
  isRefreshing,    // Auto-refetching after reconnect
  isSubscribed,    // WebSocket connected
  hasMore,         // More pages available
  error,
  fetchMore,       // Load next page
} = useEntitySocket('message', {
  limit: 50,              // Records to fetch initially (default: 20)
  skipInitialFetch: false // Set true to skip HTTP fetch
})
```

**Features:**
- Initial data fetch via HTTP (reliable, with pagination)
- Real-time updates via WebSocket when entities change
- Auto-refetch on reconnect to catch missed events
- Zero manual recovery logic

**Example:**

```tsx
function ChannelList() {
  const { 
    entities: channels, 
    isLoading, 
    isRefreshing,
    isSubscribed,
    fetchMore 
  } = useEntitySocket('channel')
  
  return (
    <div>
      {!isSubscribed && <span>🟠 Reconnecting...</span>}
      {isRefreshing && <span>Syncing...</span>}
      {Array.from(channels.values()).map(ch => (
        <Channel key={ch.entityId} data={ch} />
      ))}
      <button onClick={fetchMore}>Load More</button>
    </div>
  )
}
```

### `useMutualSocket`

Subscribe to real-time updates for mutual relationships. Same pattern as `useEntitySocket` but for mutuals.

```ts
const {
  mutuals,         // Map<string, Mutual<B, T>>
  isLoading,
  isFetchingMore,
  isRefreshing,
  isSubscribed,
  hasMore,
  error,
  fetchMore,
} = useMutualSocket(
  'channel',        // byEntityType
  channelId,        // byEntityId
  'message',        // mutualEntityType
  { limit: 30 }
)
```

**Example:**

```tsx
function ChatWindow({ channelId }) {
  const { 
    mutuals: messages, 
    isLoading,
    isRefreshing,
    fetchMore 
  } = useMutualSocket('channel', channelId, 'message', { limit: 50 })
  
  return (
    <div>
      {isRefreshing && <span>Syncing...</span>}
      {Array.from(messages.values()).map(msg => (
        <Message key={msg.entityId} data={msg} />
      ))}
    </div>
  )
}
```

### `useEphemeralSocket`

Send and receive ephemeral messages that are **not persisted** to the database. Perfect for typing indicators, live cursors, and presence.

```ts
const {
  isSubscribed,    // WebSocket connected
  send,            // (data: T) => void
} = useEphemeralSocket<T>(
  'channel:123:typing',  // channel name
  {
    onMessage: (data, senderId) => {
      // Handle incoming ephemeral message
    }
  }
)
```

**Key behaviors:**
- Messages are broadcast to all subscribers **except the sender**
- Messages are **not stored** in the database
- Auto-re-subscribe on reconnect
- Channel-based routing (e.g., `channel:123:typing`, `doc:456:cursor`)

**Example - Typing Indicator:**

```tsx
function MessageInput({ channelId, currentUserId }) {
  const { send } = useEphemeralSocket(`channel:${channelId}:typing`)
  
  const handleTyping = (value: string) => {
    if (value.trim()) {
      send({ 
        type: 'typing', 
        userId: currentUserId,
        userName: 'Alice'
      })
    }
  }
  
  return <input onChange={(e) => handleTyping(e.target.value)} />
}

function ChatWindow({ channelId, currentUserId }) {
  const [typingUsers, setTypingUsers] = useState(new Set())
  
  useEphemeralSocket(`channel:${channelId}:typing`, {
    onMessage: (data) => {
      // Don't show typing indicator for current user
      if (data.userId === currentUserId) return
      
      if (data.type === 'typing') {
        setTypingUsers(prev => new Set([...prev, data.userName]))
      }
    }
  })
  
  return (
    <div>
      {typingUsers.size > 0 && (
        <div>{Array.from(typingUsers).join(', ')} is typing...</div>
      )}
    </div>
  )
}
```

## Auto-Recovery

All WebSocket hooks automatically handle reconnection:

1. **Exponential backoff**: 1s → 2s → 4s... max 30s, max 10 retries
2. **Heartbeat**: 30s ping/pong to detect stale connections
3. **Auto-refetch**: On reconnect, hooks automatically refetch to catch missed events
4. **Re-subscription**: All subscriptions are restored after reconnect

```tsx
function ChatWindow() {
  const { isRefreshing } = useMutualSocket('channel', id, 'message')
  
  return (
    <div>
      {/* Shows when auto-refetching after reconnect */}
      {isRefreshing && <span>Syncing...</span>}
    </div>
  )
}
```

## Best Practices

### 1. Use HTTP for Mutations

Always use HTTP for create/update/delete operations. WebSocket is for receiving updates only.

```tsx
// ✅ Good: HTTP for mutations
const { createEntity } = useEntities('message')
await createEntity({ content: 'Hello' })

// ❌ Bad: Don't send mutations via WebSocket
```

### 2. Handle Reconnection Gracefully

Show users when the connection is reconnecting or syncing.

```tsx
const { isSubscribed, isRefreshing } = useEntitySocket('channel')

<span>
  {!isSubscribed && '🟠 Reconnecting...'}
  {isRefreshing && '🔄 Syncing...'}
</span>
```

### 3. Use Ephemeral for Temporary State

Don't pollute your entity model with temporary state.

```tsx
// ✅ Good: Ephemeral for typing indicators
useEphemeralSocket('channel:123:typing')

// ❌ Bad: Don't create entities for temporary state
editEntity('channel', channelId, { typingUserId: 'alice' })
```

### 4. Channel Naming Convention

Use consistent channel names for ephemeral messages:

```ts
// Entity-scoped ephemeral
`channel:${channelId}:typing`
`channel:${channelId}:presence`

// Document-scoped ephemeral  
`doc:${docId}:cursor`
`doc:${docId}:selection`

// User-scoped ephemeral
`user:${userId}:status`
```

## Scalability

- **Entity-type subscriptions**: Subscribe to all changes of an entity type, not individual IDs
- **No polling**: WebSocket pushes updates only when data changes
- **Cost-effective**: Near-zero cost when no connections (pay per connection-minute and messages)
- **Limits**: 10K concurrent connections per API Gateway (can be increased)

## Troubleshooting

### Connection not establishing
- Check WebSocket endpoint URL is correct
- Verify auth token is being passed
- Check browser console for connection errors

### Not receiving updates
- Ensure entity type matches exactly (case-sensitive)
- Check that DynamoDB Streams are enabled for the table
- Verify the `broadcast` Lambda is processing stream events

### Missing events after reconnect
- Hooks auto-refetch on reconnect by default
- Check `isRefreshing` state to see if refetch is in progress
- Ensure `skipInitialFetch` is not set to `true`

### Ephemeral messages not received
- Verify both sender and receiver are subscribed to the same channel
- Remember: sender doesn't receive their own ephemeral messages
- Check channel name is exactly the same (case-sensitive)
