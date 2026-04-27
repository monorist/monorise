# Packages

Monorise is available as a single combined package or as individual packages.

## Combined package

```bash
npm install monorise
```

Import from subpaths:

```ts
import { createEntityConfig } from 'monorise/base';
import { useEntities, useMutuals } from 'monorise/react';
import { CoreFactory } from 'monorise/core';
import { MonoriseCore } from 'monorise/sst';
import { generateWebSocketTicket } from 'monorise/proxy';
```

## Individual packages

| Package | Role | Install |
|---------|------|---------|
| `@monorise/base` | Entity config + schema/types (Zod) | `npm i @monorise/base` |
| `@monorise/core` | Hono API, DynamoDB repositories, processors, event utils | `npm i @monorise/core` |
| `@monorise/cli` | Generates `.monorise/config.ts` + `.monorise/handle.ts` | `npm i @monorise/cli` |
| `@monorise/react` | Client SDK — hooks, stores, axios helpers | `npm i @monorise/react` |
| `@monorise/sst` | SST v3 module — API, bus, table, queues, processors | `npm i @monorise/sst` |
| `@monorise/proxy` | Server-side helpers for proxy routes (ticket generation) | `npm i @monorise/proxy` |

## `monorise/base`

The foundation package. Exports `createEntityConfig`, `Entity` enum, `EntitySchemaMap`, `CreatedEntity`, and `DraftEntity` types. All entity configurations are built on Zod schemas.

## `monorise/core`

The backend runtime. Provides:
- **Hono API handlers** for entity, mutual, and tag CRUD
- **DynamoDB repositories** for single-table access patterns
- **Processors** (mutual, tag, prejoin, replication) for keeping denormalized data in sync
- **Event utilities** for EventBridge integration

## `monorise/cli`

The code generation tool. Watches your entity config files and generates:
- `.monorise/config.ts` — aggregated entity types, schemas, and configs
- `.monorise/handle.ts` — Lambda handler exports for SST wiring

## `monorise/react`

The frontend SDK for React applications. Provides:
- **Hooks**: `useEntities`, `useEntity`, `useMutuals`, `useTaggedEntities`
- **WebSocket hooks**: `useEntityFeed`, `useEntitySocket`, `useMutualSocket`, `useEphemeralSocket`
- **Actions**: `createEntity`, `editEntity`, `deleteEntity`, `createMutual`
- **State management**: Zustand-based stores with optimistic updates
- **Utilities**: Modal management, loading/error stores

## `monorise/proxy`

Server-side helpers for proxy routes. Currently provides:
- **`generateWebSocketTicket()`** — issues a WebSocket ticket for entity feed subscriptions. Call this from your proxy route after validating auth.

See [WebSocket > Entity Feed](/websocket#entity-feed) for usage.

## `monorise/sst`

The SST v3 infrastructure module. Creates:
- API Gateway + Lambda (Hono)
- DynamoDB single table with indexes
- EventBridge bus
- SQS queues for processors
- DynamoDB stream for replication

## Where to look in the repo

| Area | Path |
|------|------|
| Core API + processors | `packages/core/*` |
| SST v3 module | `packages/sst/*` |
| CLI generator | `packages/cli/*` |
| Shared types | `packages/base/*` |
| React SDK | `packages/react/*` |
| Proxy helpers | `packages/proxy/*` |
