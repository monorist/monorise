# Getting Started

Monorise is an open-source DynamoDB single-table toolkit that powers the core data layer for applications built on DynamoDB. It provides a shared data model (schemas + relationships), a ready-made API surface (entities, mutuals, tags), and background processors to keep denormalized access patterns in sync.

## What it solves

- **Single-table DynamoDB modeling** without hand-writing complex queries.
- **Relational-style access** via `Entity`, `Mutual`, and `Tag` concepts.
- **Event-driven maintenance** (mutual/tag/prejoin processors + replication).
- **Shared schema + types** across backend and frontend.

## Prerequisites

- Node.js 20+
- npm 10+
- AWS account/infrastructure context for runtime integration (SST + DynamoDB)

## Installation

Install the combined package:

```bash
npm install monorise zod
```

### Peer dependencies

Depending on which parts of monorise you use, you may need additional peer dependencies:

| Use case | Peer dependency | Install |
|----------|----------------|---------|
| Backend API | `hono` | `npm install hono` |
| Frontend (React) | `react`, `react-dom` | Included with Next.js/CRA |
| Infrastructure | `sst` | `npm install sst` |

::: tip
Frontend-only projects (e.g., a Next.js app consuming the monorise API) only need `monorise` and `zod` — no need to install `hono` or `sst`.
:::

### Individual packages (alternative)

```bash
npm install @monorise/base @monorise/core @monorise/cli zod hono
npm install @monorise/react   # optional: React SDK
npm install @monorise/sst sst # optional: SST v3 infra module
```

## Quickstart

Initialize a project skeleton (creates `monorise.config.ts` and a starter entity):

```bash
npx monorise init
```

Example entity config:

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

Generate monorise artifacts from your config:

```bash
npx monorise build
```

For watch mode while developing entity configs:

```bash
npx monorise dev
```

This generates `.monorise/config.ts` and `.monorise/handle.ts` for runtime wiring.

## Project config (`monorise.config.ts`)

The `monorise.config.ts` file at your project root tells the CLI where to find your entity configs and custom routes:

```ts
export default {
  // Directory containing your entity config files
  configDir: './monorise/configs',

  // (Optional) Hono app instance for custom API routes (mounted at /core/app/*)
  customRoutes: './src/routes',
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

## Deploy with SST v3

Monorise is designed to run on AWS with [SST v3](https://sst.dev). The `monorise/sst` module provisions everything you need — API Gateway, DynamoDB table, EventBridge bus, SQS queues for processors, and DynamoDB streams for replication — in a single construct.

```bash
npm install sst
```

In your `sst.config.ts`:

```ts
/// <reference path="./.sst/platform/config.d.ts" />
export default $config({
  app(input) {
    return {
      name: 'my-app',
      removal: input?.stage === 'production' ? 'retain' : 'remove',
      home: 'aws',
    };
  },
  async run() {
    const { monorise } = await import('monorise/sst');

    const { bus, api, table, alarmTopic } = new monorise.module.Core('core', {
      allowOrigins: ['http://localhost:3000'],
    });

    // Link to your frontend
    new sst.aws.Nextjs('Web', {
      link: [api],
    });
  },
});
```

### What `monorise.module.Core` creates

| Resource | Description |
|----------|-------------|
| `api` | API Gateway v2 with CORS, routing to Hono Lambda |
| `table` | DynamoDB single table with GSIs and replication indexes |
| `bus` | EventBridge bus for entity events |
| `alarmTopic` | SNS topic for processor error alerts |
| Mutual processor | SQS + Lambda for mutual relationship sync |
| Tag processor | SQS + Lambda for tag index sync |
| Prejoin processor | SQS + Lambda for computed relationship sync |
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

## Common commands

```bash
npx monorise init     # scaffold a new project
npx monorise dev      # watch mode — regenerates on config changes
npx monorise build    # one-time build
```
