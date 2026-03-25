# Custom Routes

Monorise provides a full CRUD API out of the box, but most applications need custom business logic — validation workflows, third-party integrations, or composite operations. Custom routes let you extend the monorise API with your own [Hono](https://hono.dev) endpoints.

Custom routes are mounted under `/core/app/*` and have access to the same infrastructure (DynamoDB, EventBridge, entity services) as the built-in routes.

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

## Authentication

All routes under `/core/*` (including custom routes) are protected by the API key middleware. Requests must include a valid `x-api-key` header matching one of the keys configured in the `API_KEYS` secret.

If you need route-specific auth (e.g., JWT validation), add Hono middleware to your custom routes:

```ts
export default (container: DependencyContainer) => {
  const app = new Hono();

  // Public route
  app.get('/health', (c) => c.json({ status: 'ok' }));

  // Protected route with custom middleware
  app.use('/admin/*', async (c, next) => {
    const token = c.req.header('Authorization');
    // validate token...
    await next();
  });

  app.get('/admin/stats', async (c) => {
    return c.json({ totalUsers: 42 });
  });

  return app;
};
```
