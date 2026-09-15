---
'@monorise/core': minor
'@monorise/react': minor
'@monorise/sst': minor
---

Add WebSocket layer for real-time entity updates

### Features
- Optional WebSocket support in MonoriseCore with `webSocket: { enabled: true }` config
- HTTP for mutations (reliable) + WebSocket for real-time updates (scalable)
- Entity-type subscriptions for scalability (not entity-id)
- Auto-refetch on reconnect to catch missed events during disconnect
- Lambda handlers: $connect, $disconnect, $default, broadcast
- DynamoDB Streams integration for change broadcasting

### Migration
```typescript
// Before
import { WebSocketManager } from '@monorise/core'

// After  
import { WebSocketManager } from '@monorise/react'
```

### New React Hooks
- `useWebSocketConnection()`: Monitor connection state
- `useEntitySocket(entityType)`: Subscribe to entity type changes
- `useMutualSocket(byEntityType, byEntityId, mutualEntityType)`: Subscribe to mutual relationship changes
- `useEphemeralSocket(channel)`: Ephemeral messaging for typing indicators, live cursors, presence
