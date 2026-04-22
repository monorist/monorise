---
"@monorise/react": minor
---

Add `useEntityFeed` hook for graph-aware real-time subscriptions.

- Ticket-based WebSocket connection (default route or custom ticketEndpoint)
- Auto-routes entity/mutual broadcast events into zustand stores
- Proactive ticket refresh before expiry
- Periodic sleep detection with automatic reconnect
- Ticket fetch retry with exponential backoff on transient errors
- Stale manager identity check prevents reconnect loops
- React strict mode safe via connectingRef guard
