# @monorise/proxy

## 3.1.0-dev.0

### Minor Changes

- 7b9cd73: Add ticket-based auth for WebSocket entity feed subscriptions.

  - `POST /ws/ticket/:entityType/:entityId` endpoint for ticket generation
  - Tickets are short-lived (30min TTL), one-time use, stored in DynamoDB
  - `$connect` handler supports ticket auth alongside token auth
  - Feed subscriptions auto-created on ticket-based connections
  - `monorise/proxy` package with `generateWebSocketTicket()` helper
  - feedTypes resolved transitively through mutual config graph
  - Fix: baseSchema now always included in FinalSchemaType
