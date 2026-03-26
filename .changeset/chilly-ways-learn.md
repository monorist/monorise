---
'@monorise/react': minor
---

Enhanced WebSocket hooks with pagination and auto-recovery

### Features
- `useEntitySocket`: Initial HTTP fetch + WebSocket real-time updates with pagination support
- `useMutualSocket`: Same pattern for mutual relationships
- Auto-refetch on reconnect to catch missed events during disconnect
- `isRefreshing` state to indicate sync in progress
- `fetchMore()` for loading additional data
- `hasMore` flag for pagination control

### Example Usage
```typescript
const { 
  entities,         // Map<string, Entity>
  isLoading,        // Initial fetch
  isFetchingMore,   // Loading more pages
  isRefreshing,     // Auto-refetch after reconnect
  isSubscribed,     // WebSocket connected
  hasMore,          // More pages available
  fetchMore 
} = useEntitySocket('message', { limit: 50 })
```
