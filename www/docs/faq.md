# FAQ

## Why DynamoDB over PostgreSQL?

Both are excellent databases, but they serve different scaling models:

| Aspect | DynamoDB | PostgreSQL |
|--------|----------|------------|
| **Scaling** | Automatic, unlimited horizontal scaling | Vertical scaling; horizontal requires sharding/read replicas |
| **Pricing** | Pay-per-request (can scale to zero) | Always-on instance cost even at zero traffic |
| **Latency** | Single-digit millisecond at any scale | Degrades under high concurrency or large datasets |
| **Maintenance** | Fully managed, zero ops | Requires patching, vacuuming, connection pooling, backups |
| **Schema** | Schemaless (monorise adds type safety on top) | Rigid schema with migrations |

**Monorise exists because DynamoDB's trade-off is complexity, not capability.** Single-table design on DynamoDB is notoriously hard to get right — you need to plan access patterns upfront, manage denormalization, and write complex key expressions. Monorise eliminates that complexity while keeping DynamoDB's scaling and cost advantages.

If your app will always run on a single server with predictable traffic, PostgreSQL is a great choice. If you want zero-ops infrastructure that scales from zero to millions of requests without provisioning or connection pool headaches, DynamoDB + Monorise is the better fit.

## Why single-table design?

DynamoDB charges per request and per table. A single-table design:

- **Reduces costs** — fewer tables means fewer indexes to maintain
- **Guarantees O(1) reads** — every query hits a partition directly, no joins or scans
- **Simplifies infrastructure** — one table, one stream, one backup policy

The downside is complexity in modeling, which is exactly what monorise handles for you.

## Do I need to understand DynamoDB to use monorise?

No. Monorise abstracts away DynamoDB's key design, access patterns, and denormalization. You define entities with Zod schemas and relationships with config — monorise handles the rest.

That said, understanding the basics (partition keys, sort keys, GSIs) helps when debugging or optimizing.

## Can I use monorise without SST?

The core packages (`monorise/base`, `monorise/core`, `monorise/react`) are framework-agnostic. The `monorise/sst` module is a convenience layer for provisioning AWS infrastructure.

You can use monorise with any deployment tool (CDK, Terraform, Pulumi, SAM) as long as you provision:
- A DynamoDB table with the expected indexes
- An EventBridge bus
- SQS queues for processors
- Lambda functions for the API and processors

## Can I use monorise with frameworks other than React?

Currently, the frontend SDK (`monorise/react`) only supports React. Support for Vue, Svelte, Solid, and other frameworks is on the [roadmap](/roadmap#_12-multi-framework-support-vue-svelte-solid-etc).

The backend packages (`monorise/base`, `monorise/core`, `monorise/cli`, `monorise/sst`) work with any frontend.

## How does monorise handle data consistency?

Monorise uses **eventual consistency** for denormalized data:

1. When you create/update an entity, the API writes to DynamoDB immediately (strongly consistent)
2. Events are published to EventBridge, which triggers processors via SQS
3. Processors update related records (mutuals, tags, prejoins, replicas) asynchronously

In practice, propagation happens within milliseconds to seconds. The React SDK's optimistic updates make the UI feel instant regardless.

## What happens if a processor fails?

Failed processor messages are sent to a **Dead Letter Queue (DLQ)**. Monorise creates an SNS alarm topic so you can be notified of failures. If you configure a `slackWebhook` in `MonoriseCore`, you'll get Slack alerts automatically.

Failed messages can be replayed from the DLQ once the issue is resolved.

## Can I add custom API routes?

Yes. Define a Hono app and point to it via `customRoutes` in your `monorise.config.ts`:

```ts
// monorise.config.ts
export default {
  configDir: './monorise/configs',
  customRoutes: './src/routes',
};
```

```ts
// src/routes.ts
import { Hono } from 'hono';

const app = new Hono();
app.get('/health', (c) => c.json({ status: 'ok' }));

export default app;
```

Custom routes are mounted under `/core/app/*`.

## How do I migrate existing data when schemas change?

Currently, monorise doesn't have built-in migration tooling (it's on the [roadmap](/roadmap#_2-migration-tooling)). For now:

- **Adding optional fields**: No migration needed — existing records simply won't have the field
- **Renaming fields**: Write a one-off script to update existing records
- **Changing tag processors**: Reprocess entities by triggering update events

## Is monorise production-ready?

Monorise is actively used in production applications. However, it's still evolving — expect breaking changes between minor versions until 1.0. Pin your versions and use changesets for upgrades.
