# Getting Started

Monorise is an open-source DynamoDB single-table toolkit that powers the core data layer for applications built on DynamoDB. It provides a shared data model (schemas + relationships), a ready-made API surface (entities, mutuals, tags), and background processors to keep denormalized access patterns in sync.

## What it solves

- **Single-table DynamoDB modeling** without hand-writing complex queries.
- **Relational-style access** via `Entity`, `Mutual`, and `Tag` concepts.
- **Event-driven maintenance** (mutual/tag/tree processors + replication).
- **Zero schema drift** — One Zod config drives DB, API, and frontend types. `monorise dev` auto-regenerates on every change.

## Prerequisites

- Node.js 20+
- npm 10+
- AWS account/infrastructure context for runtime integration (SST + DynamoDB)

## Quickstart

### 1. Create a new project

```bash
npx monorise init --name my-app
```

This single command creates a production-ready monorepo:

```
my-app/
├── apps/web/                        # Next.js frontend (Tailwind CSS)
│   └── src/
│       ├── app/
│       │   ├── layout.tsx           # GlobalInitializer + GlobalLoader wired in
│       │   ├── page.tsx             # Example page with useEntities + createEntity
│       │   ├── globals.css          # Shadcn theme variables (oklch)
│       │   └── api/
│       │       ├── proxy-request.ts # Rewrites /api/* to monorise backend
│       │       └── [...proxy]/route.ts  # Catch-all route (GET/POST/PUT/PATCH/DELETE)
│       ├── components/
│       │   ├── global-initializer.tsx   # Monorise store configuration
│       │   ├── global-loader.tsx        # Full-screen interruptive loading overlay
│       │   └── ui/                      # Shadcn UI components (button, card, input, label)
│       └── lib/utils.ts             # cn() — clsx + tailwind-merge helper
├── services/core/         # Hono backend routes
│   └── routes.ts
├── monorise/configs/      # Entity definitions
│   └── user.ts            # Starter User entity (displayName, email)
├── monorise.config.ts     # Points to configs dir + custom routes
├── sst.config.ts          # SST v3 + Monorise module configured
├── tsconfig.json          # Path aliases (#/monorise/*, #/*)
└── .monorise/             # Generated types + handlers (do not edit)
```

### What's included out of the box

| Feature | Description |
|---------|-------------|
| **Shadcn UI** | Pre-installed button, card, input, label components with theme variables |
| **Global Loader** | `useInterruptiveLoadStore` → full-screen loading overlay via portal |
| **Global Initializer** | Calls `Monorise.config()` with your entity config on app mount |
| **API Proxy** | Next.js catch-all route at `/api/*` that proxies requests to monorise backend |
| **Path Aliases** | `#/monorise/*` for generated types, `#/*` for app-local imports |

### 2. Start development

```bash
cd my-app
npx sst dev
```

That's it! Open http://localhost:3000 to see the example app.

## Understanding the structure

### Entity config (`monorise/configs/user.ts`)

Define your data model with Zod:

```ts
import { createEntityConfig } from 'monorise/base';
import { z } from 'zod/v4';

const baseSchema = z
  .object({
    displayName: z.string().min(1),
    email: z.string().email(),
  })
  .partial();

const createSchema = z.object({
  displayName: z.string().min(1),
  email: z.string().email(),
});

const config = createEntityConfig({
  name: 'user',
  displayName: 'User',
  baseSchema,
  createSchema,
  searchableFields: ['displayName', 'email'],
  uniqueFields: ['email'],
});

export default config;
```

### Frontend page (`apps/web/src/app/page.tsx`)

Use the React hooks to interact with your data:

```tsx
'use client';

import { useEntities, createEntity } from 'monorise/react';
import { Entity } from '#/monorise/config';

export default function Home() {
  const { entities: users, isLoading } = useEntities(Entity.USER);

  const handleCreate = async () => {
    await createEntity(Entity.USER, {
      displayName: 'John Doe',
      email: 'john@example.com',
    });
    // The list automatically updates via the store!
  };

  return (
    <div>
      {users?.map((user) => (
        <div key={user.entityId}>
          {user.data.displayName} — {user.data.email}
        </div>
      ))}
    </div>
  );
}
```

### Build and watch commands

Generate types from entity configs:

```bash
npx monorise build
```

Watch mode for development:

```bash
npx monorise dev
```

---

## Project config (`monorise.config.ts`)

The `monorise.config.ts` file at your project root tells the CLI where to find your entity configs and custom routes:

```ts
export default {
  // Directory containing your entity config files
  configDir: './monorise/configs',

  // (Optional) Hono app for custom API routes (mounted at /core/app/*)
  customRoutes: './services/core/routes.ts',
};
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `configDir` | `string` | Yes | Path to directory containing entity config `.ts` files |
| `customRoutes` | `string` | No | Path to a Hono app module for custom routes |

::: tip
The CLI auto-detects whether your project uses the combined `monorise` package or scoped `@monorise/*` packages and generates the correct import paths in `.monorise/handle.ts` accordingly.
:::

### Entity config directory

The `configDir` should contain one `.ts` file per entity, each exporting a default `createEntityConfig` result:

```
monorise/configs/
  user.ts
  organisation.ts
  order.ts
```

### Custom routes

The `customRoutes` file must default-export a Hono app instance. These routes are mounted under `/core/app/*`:

```ts
import { Hono } from 'hono';

const app = new Hono();

app.get('/health', (c) => c.json({ status: 'ok' }));

app.post('/custom-action', async (c) => {
  // Access DI container, entity services, etc.
  const body = await c.req.json();
  return c.json({ result: 'done' });
});

export default app;
```

## Generated code and type safety

When you run `monorise build` or `monorise dev`, the CLI generates `.monorise/config.ts` which includes:

- An `Entity` enum with all your entity names
- TypeScript types inferred from each entity's `baseSchema`
- An `EntitySchemaMap` interface mapping entity types to their schemas
- **Module augmentation** declarations that extend `monorise/base` types

The module augmentation is what makes the entire system type-safe. For example, when you call `useEntity(Entity.USER, id)`, the returned `entity.data` is strongly typed with your user schema fields — not `any`.

```ts
// Auto-generated in .monorise/config.ts
declare module 'monorise/base' {
  export enum Entity {
    USER = 'user',
  }
  export type UserType = z.infer<typeof userConfig.finalSchema>;
  export interface EntitySchemaMap {
    [Entity.USER]: UserType;
  }
}
```

::: info
You never need to write this manually — the CLI generates it from your entity configs.
:::

## SST Configuration Reference

The `monorise.module.Core` construct provisions everything you need — API Gateway, DynamoDB table, EventBridge bus, SQS queues for processors, and DynamoDB streams for replication — in a single construct.

### What `monorise.module.Core` creates

| Resource | Description |
|----------|-------------|
| `api` | API Gateway v2 with CORS, routing to Hono Lambda |
| `table` | DynamoDB single table with GSIs and replication indexes |
| `bus` | EventBridge bus for entity events |
| `alarmTopic` | SNS topic for processor error alerts |
| Mutual processor | SQS + Lambda for mutual relationship sync |
| Tag processor | SQS + Lambda for tag index sync |
| Tree processor | SQS + Lambda for computed relationship sync |
| Replication processor | DynamoDB stream + Lambda for denormalized data sync |
| CloudWatch dashboard | Pre-built dashboard with Lambda metrics, DLQ depth, and table stats |

### Configuration options

```ts
new monorise.module.Core('core', {
  allowOrigins: ['https://myapp.com'],  // CORS origins
  allowHeaders: ['x-custom-header'],     // Additional CORS headers
  tableTtl: 'expiresAt',                // DynamoDB TTL attribute name
  slackWebhook: 'https://hooks...',     // Slack alerts for processor errors
  configRoot: './services/api',          // Custom config root path
});
```

For the full SST SDK reference including `QFunction`, see the [SST SDK](/sst) page.

### Development

SST's dev mode works seamlessly with monorise. The `monorise.module.Core` constructor automatically registers a dev command that runs `monorise dev` in watch mode:

```bash
npx sst dev
```

This starts your local dev environment with live Lambda functions and auto-regenerating monorise config.

### Deployment

Deploy to production using SST:

```bash
npx sst deploy --stage prod
```

For comprehensive deployment guides, environment management, and CI/CD setup, see the [SST documentation](https://sst.dev/docs).

::: warning Before you start building
Read the [Best Practices](/best-practices) guide first — especially the **edge-auth proxy pattern**. How you connect your frontend to the monorise API Gateway has significant security implications.
:::


