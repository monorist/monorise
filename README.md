# Monorise

<p align="center">
  <strong>DynamoDB Single-Table Toolkit</strong><br/>
  Type-safe, event-driven data layer for applications built on DynamoDB.
</p>

<p align="center">
  <a href="https://monorise.dev">📚 Documentation</a> •
  <a href="https://monorise.dev/getting-started">🚀 Quickstart</a> •
  <a href="https://monorise.dev/concepts">💡 Concepts</a> •
  <a href="https://github.com/monorist/monorise/issues">💬 Issues</a>
</p>

---

## What is Monorise?

Monorise is an open-source toolkit that powers the core data layer for applications built on DynamoDB. Define your data models with Zod schemas, and get:

- **A ready-made REST API** for entities, relationships, and queries
- **Event-driven processors** that keep denormalized data in sync
- **Full type safety** from backend to frontend
- **SST v3 integration** for one-command deployment to AWS

## Full-Stack in Minutes

**1. Create your project:**

```bash
npx monorise init --name my-app
cd my-app
```

**2. Define your entity:**

```ts
// monorise/configs/member.ts
import { createEntityConfig } from 'monorise/base';
import { z } from 'zod/v4';

const baseSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  role: z.enum(['admin', 'member']),
}).partial();

export default createEntityConfig({
  name: 'member',
  displayName: 'Member',
  baseSchema,
  searchableFields: ['name', 'email'],
  uniqueFields: ['email'],
});
```

**3. Query from React:**

```tsx
// apps/web/src/app/page.tsx
import { useEntities, createEntity } from 'monorise/react';
import { Entity } from '#/monorise/config';

export default function MembersPage() {
  const { entities: members, isLoading } = useEntities(Entity.MEMBER);

  return (
    <div>
      {members?.map((m) => (
        <div key={m.entityId}>{m.data.name} — {m.data.email}</div>
      ))}
    </div>
  );
}
```

That's it — relational queries on DynamoDB without the design doc. Single-table performance without the single-table pain.

## Quickstart

```bash
# Create a new project with everything set up
npx monorise init --name my-app

# Start development
cd my-app
npx sst dev

# Deploy to production
npx sst deploy --stage prod
```

`monorise init` scaffolds a production-ready monorepo:

```
my-app/
├── apps/web/                        # Next.js frontend
│   └── src/
│       ├── app/
│       │   ├── layout.tsx           # GlobalInitializer + GlobalLoader wired in
│       │   ├── page.tsx             # Example page with useEntities
│       │   ├── globals.css          # Shadcn theme variables
│       │   └── api/
│       │       ├── proxy-request.ts # API proxy utility
│       │       └── [...proxy]/route.ts  # Catch-all proxy to monorise backend
│       ├── components/
│       │   ├── global-initializer.tsx   # Monorise store config
│       │   ├── global-loader.tsx        # Interruptive loading overlay
│       │   └── ui/                      # Shadcn UI (button, card, input, label)
│       └── lib/utils.ts             # cn() helper
├── services/core/
│   └── routes.ts                    # Hono backend routes
├── monorise/configs/
│   └── user.ts                      # Starter entity definition
├── sst.config.ts                    # SST + Monorise configured
└── .monorise/                       # Generated types
```

Read the [Getting Started Guide](https://monorise.dev/getting-started) for the complete walkthrough.

## Why Monorise?

| Feature | Description |
|---------|-------------|
| **🗄️ Single-Table DynamoDB** | One table, O(1) performance for every query. Denormalization handled automatically. |
| **🔄 Zero Schema Drift** | One Zod config drives DB, backend, and frontend. `monorise dev` auto-regenerates types on every change. |
| **🚀 Ship in Hours** | From `git init` to production API. No migration scripts, no access pattern spreadsheets.
| **🔗 Relational Patterns** | Entity, Mutual, and Tag concepts for relational-style queries on DynamoDB. |
| **📦 Full-Stack SDK** | Backend (Hono), React hooks, SST v3 infrastructure — one package. |
| **🧠 Token-Efficient** | Built-in CRUD, relationships, and tagging. Less code to write, fewer tokens to generate/review. |

## Core Concepts

- **[Entity](https://monorise.dev/concepts/entities)** — A first-class record (e.g., `user`, `order`)
- **[Mutual](https://monorise.dev/concepts/mutuals)** — A relationship between two entities with optional data (e.g., `learner` enrolled in `course`)
- **[Tag](https://monorise.dev/concepts/tags)** — Key/value access patterns for fast querying
- **[Tree](https://monorise.dev/concepts/prejoins)** — Computed relationships that avoid multi-hop queries

## Documentation

- **[Getting Started](https://monorise.dev/getting-started)** — Installation, configuration, and first steps
- **[Concepts](https://monorise.dev/concepts)** — Understanding Entities, Mutuals, Tags, and Trees
- **[SST SDK](https://monorise.dev/sst)** — Infrastructure and deployment reference
- **[React SDK](https://monorise.dev/react)** — Frontend hooks and utilities
- **[Best Practices](https://monorise.dev/best-practices)** — Security patterns and recommendations
- **[FAQ](https://monorise.dev/faq)** — Common questions and answers

## Architecture Overview

```
┌─────────┐     ┌─────────────┐     ┌─────────────────┐
│  Client │────▶│  Hono API   │────▶│ Entity/Mutual/  │
│         │     │  /core/*    │     │ Tag Services    │
└─────────┘     └─────────────┘     └────────┬────────┘
                                             │
                         ┌───────────────────┴──────────┐
                         ▼                              ▼
                  ┌─────────────┐              ┌────────────────┐
                  │  DynamoDB   │◀────────────▶│  EventBridge   │
                  │ Single Table│              │     Bus        │
                  └─────────────┘              └───────┬────────┘
                                                       │
                              ┌────────────────────────┼────────────────────────┐
                              ▼                        ▼                        ▼
                       ┌─────────────┐          ┌─────────────┐          ┌─────────────┐
                       │ SQS Mutual  │          │  SQS Tag    │          │  SQS Tree   │
                       │  Processor  │          │  Processor  │          │  Processor  │
                       └─────────────┘          └─────────────┘          └─────────────┘
```

See [Architecture](https://monorise.dev/architecture) for the detailed design.

## Project Structure

```
├── packages/
│   ├── base/          # Entity config + schemas (Zod)
│   ├── core/          # Hono API, DynamoDB repos, processors
│   ├── cli/           # CLI for generating artifacts
│   ├── react/         # React hooks and client SDK
│   └── sst/           # SST v3 infrastructure module
├── www/               # Documentation site (VitePress)
└── examples/          # Example projects
```

## Contributing

See [Contributing Guide](CONTRIBUTING.md) for workflow, changesets, and PR guidelines.

## License

Distributed under the MIT License. See [LICENSE](./LICENSE).
