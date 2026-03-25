# Custom Routes

Monorise provides a full CRUD API out of the box, but most applications need custom business logic — validation workflows, third-party integrations, or composite operations. Custom routes let you extend the monorise API with your own [Hono](https://hono.dev) endpoints.

Custom routes are mounted under `/core/app/*` and have access to the same infrastructure (DynamoDB, EventBridge, entity services) as the built-in routes.

::: tip
Business logic should live in custom routes, not in your frontend proxy layer. See [Best Practices](/best-practices) for the recommended architecture.
:::

## Setup

Point `customRoutes` in your `monorise.config.ts` to a file that exports a Hono app:

```ts
// monorise.config.ts
export default {
  configDir: './monorise/configs',
  customRoutes: './src/routes',
};
```

## Basic routes

Export a Hono app instance with your custom endpoints:

```ts
// src/routes.ts
import { Hono } from 'hono';

const app = new Hono();

app.get('/health', (c) => {
  return c.json({ status: 'ok' });
});

app.post('/contact', async (c) => {
  const body = await c.req.json();
  // send email, log to external service, etc.
  return c.json({ message: 'Message sent' });
});

export default app;
```

These are accessible at:
- `GET /core/app/health`
- `POST /core/app/contact`

## Accessing the dependency container

For routes that need to interact with monorise's data layer, export a **function** that receives the `DependencyContainer` instead of a plain Hono app:

```ts
// src/routes.ts
import { Hono } from 'hono';
import type { DependencyContainer } from 'monorise/core';

export default (container: DependencyContainer) => {
  const app = new Hono();

  app.post('/register', async (c) => {
    const body = await c.req.json();

    // Use entity service to create a user
    const user = await container.entityService.createEntity({
      entityType: 'user',
      entityPayload: body,
      accountId: body.email,
    });

    // Use event utils to publish a custom event
    await container.eventUtils.publishEvent({
      source: 'my-app',
      detailType: 'USER_REGISTERED',
      detail: { userId: user.entityId },
    });

    return c.json({ user });
  });

  app.get('/dashboard/:tenantId', async (c) => {
    const { tenantId } = c.req.param();

    // Query entities using the repository directly
    const members = await container.entityRepository.listEntitiesByEntity(
      'tenant',
      tenantId,
      'member',
    );

    return c.json({ members });
  });

  return app;
};
```

The monorise CLI auto-detects whether your export is a Hono app or a function, and wires it accordingly in the generated `handle.ts`.

## Available services in DependencyContainer

| Service | Description |
|---------|-------------|
| `container.entityService` | Create, update, delete entities with full lifecycle hooks |
| `container.entityRepository` | Direct DynamoDB access for entity operations |
| `container.mutualRepository` | Direct DynamoDB access for mutual operations |
| `container.tagRepository` | Direct DynamoDB access for tag operations |
| `container.eventUtils` | Publish events to EventBridge |
| `container.config` | Entity configs, allowed types, schemas |

## Calling from the frontend

Custom routes are served under `/core/app/*`. Use the `axios` instance exported from `monorise/react` — it's pre-configured with loading/error state management and response interceptors.

```ts
import { axios } from 'monorise/react';

// GET /core/app/health
const { data } = await axios.get('/core/app/health');

// POST /core/app/register
const { data: user } = await axios.post('/core/app/register', {
  name: 'Alice',
  email: 'alice@example.com',
});
```

::: tip
The `axios` instance from `monorise/react` automatically tracks loading and error state via `useLoadStore` / `useErrorStore`, and detects 401 responses for auth handling.
:::

