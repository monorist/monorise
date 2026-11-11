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

## API key permissions

With [scoped API keys](/api-keys), a custom route is a capability: you grant a key the operation, not the CRUD the route does inside. `container` services stay trusted. So a key with no direct access to `payment` can still call `/checkout`, which creates the payment under your business rules.

Declare the permission a route needs with `requires()`, per route or on a group:

```ts
import { Hono } from 'hono';
import { type DependencyContainer, requires } from 'monorise/core';

export default (container: DependencyContainer) => {
  const app = new Hono();

  app.post('/checkout', requires('checkout'), async (c) => {
    const key = c.get('apiKey');
    const order = await placeOrder(container, await c.req.json(), {
      allowDiscount: key.has('checkout:discount'),
    });
    return c.json(key.mask('order', order));
  });

  app.use('/reports/*', requires('reports'));
  app.get('/reports/sales', salesReport);

  app.get('/health', (c) => c.json({ ok: true })); // no requires(): full keys only

  return app;
};
```

A policy grants permissions by name in `routes`, and `full` keys hold every permission:

```ts
client: { entities: { ... }, routes: ['checkout'] },
support: { entities: { '*': 'read' }, routes: ['reports', 'checkout:discount'] },
```

- **A route without `requires()` is callable only by `full` keys**, so a new route never opens up to scoped keys by accident.
- **Typed names:** the CLI types `requires()` with the names your policies grant, so a misspelled name fails to compile.

The key says which kind of caller may call a route, not which user. Behind the [proxy](/proxy#custom-routes), a route takes the identity it needs from its body or path, and a route rule checks it against the session.

Inside a route, `c.get('apiKey')` is the resolved key:

| Member | Returns |
|---|---|
| `policy` | The policy name, e.g. `'client'` |
| `fingerprint` | The key's SHA-256 digest, safe to log |
| `can(action, entityType, fields?)` | Whether the key may `read` (get), `list`, `create`, `update` or `delete` that type, and those fields |
| `has(permission)` | Whether the policy grants a route permission |
| `mask(entityType, entity)` | The entity with the fields the key can't read removed |

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

