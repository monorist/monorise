---
"@monorise/core": minor
"@monorise/sst": minor
"@monorise/react": minor
"@monorise/cli": minor
---

Add optional WebSocket support for real-time entity and mutual updates.

- WebSocket handlers (connect, disconnect, default, broadcast) in core processors
- SST MonoriseCore `webSocket` config option with API Gateway WebSocket
- React hooks: `useEntitySocket`, `useMutualSocket`, `useEphemeralSocket`
- CLI generates WebSocket handler re-exports in handle.ts
- DynamoDB stream-based broadcast for entity and mutual changes
- Auto-reconnect with exponential backoff and auto-refetch on reconnect
