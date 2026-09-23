# WebSocket Chat Example

A simple real-time chat application demonstrating the Monorise WebSocket layer.

## Features

- **User Switching**: Dropdown to select which user to log in as (great for testing!)
- **Real-time Channels**: Create and join channels
- **Live Messaging**: Send and receive messages instantly via WebSocket
- **Optimistic Updates**: Messages appear immediately while syncing to server
- **Connection Status**: Visual indicator showing WebSocket connection state

## Testing Multi-User Scenarios

This example is designed for testing WebSocket functionality across multiple browser sessions:

1. Open the app in Browser A (e.g., Chrome)
2. Select "Alice Johnson" as the user
3. Open the app in Browser B (e.g., Firefox or incognito window)
4. Select "Bob Smith" as the user
5. Both users join the same channel
6. Send messages from both browsers - they'll appear instantly on both!

## WebSocket Hooks Used

This example demonstrates all the WebSocket hooks:

- `useWebSocketConnection()` - Connection state monitoring
- `useEntitySocket()` - Subscribe to channel updates
- `useMutualSocket()` - Subscribe to message updates in channels
- `useCreateEntitySocket()` - Create channels/messages with optimistic updates
- `useEntities()` - List all channels
- `useMutuals()` - List messages in a channel

## Running the Example

```bash
# Install dependencies
npm install

# Start SST dev server
npm run dev

# Or use the monorepo's dev command from root
cd ../..
npm run dev -- --filter=websocket-chat
```

The app will be available at the URL shown in the SST output (usually http://localhost:3000).

## Architecture

```
┌─────────────────┐     WebSocket      ┌──────────────────┐
│   Browser A     │◄──────────────────►│   API Gateway    │
│  (Alice)        │                    │   WebSocket API  │
└────────┬────────┘                    └────────┬─────────┘
         │                                      │
         │ HTTP                                  │ Lambda
         ▼                                      ▼
┌─────────────────┐                    ┌──────────────────┐
│  Monorise API   │◄──────────────────►│  DynamoDB Table  │
└─────────────────┘                    └──────────────────┘
         ▲                                      │
         │ HTTP                                  │ Stream
         │                                      ▼
┌────────┴────────┐                    ┌──────────────────┐
│   Browser B     │◄──────────────────►│ Broadcast Lambda │
│   (Bob)         │     WebSocket      └──────────────────┘
└─────────────────┘
```

## Notes

- This is a demo app - authentication is simplified (userId = token)
- Messages are ephemeral (not persisted beyond the DynamoDB table)
- Perfect for testing the WebSocket implementation end-to-end
