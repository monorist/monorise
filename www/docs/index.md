---
layout: home

hero:
  name: Monorise
  text: DynamoDB Single-Table Toolkit
  image:
    src: /logo.png
    alt: Monorise
  tagline: Type-safe, event-driven data layer for applications built on DynamoDB. Define schemas, get APIs, relationships, and processors automatically.
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/monorist/monorise

features:
  - icon: "\U0001F5C4\uFE0F"
    title: Single-Table DynamoDB
    details: One table, O(1) performance for every query. Monorise handles denormalization and replication automatically.
  - icon: "\U0001F512"
    title: Type-Safe Schemas
    details: Define entities with Zod schemas. Get full TypeScript types across backend and frontend with zero code generation delay.
  - icon: "\u26A1"
    title: Event-Driven Processors
    details: Mutual, tag, and prejoin processors keep denormalized access patterns in sync via EventBridge and SQS.
  - icon: "\U0001F517"
    title: Relational Access Patterns
    details: Entity, Mutual, and Tag concepts give you relational-style queries on DynamoDB without complex hand-written expressions.
  - icon: "\U0001F4E6"
    title: Full-Stack SDK
    details: Backend API (Hono), React hooks with caching, SST v3 infrastructure module — one package covers the entire stack.
  - icon: "\U0001F6E0\uFE0F"
    title: CLI Code Generation
    details: Run monorise dev to watch entity configs and auto-generate handlers, types, and Lambda entry points.
---

## Full-stack in minutes

Define your entities, deploy with SST, and query from React — all type-safe, all from one package.

::: code-group

```ts [sst.config.ts]
export default $config({
  app(input) {
    return { name: 'my-app', home: 'aws' };
  },
  async run() {
    const { monorise } = await import('monorise/sst');

    const { api } = new monorise.module.Core('core', {
      allowOrigins: ['http://localhost:3000'],
    });

    new sst.aws.Nextjs('Web', {
      link: [api],
    });
  },
});
```

```ts [monorise/configs/member.ts]
import { createEntityConfig } from 'monorise/base';
import { z } from 'zod/v4';

const baseSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  role: z.enum(['admin', 'member']),
}).partial();

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

export default createEntityConfig({
  name: 'member',
  displayName: 'Member',
  baseSchema,
  createSchema,
  searchableFields: ['name', 'email'],
  uniqueFields: ['email'],
  tags: [
    {
      name: 'role',
      processor: (entity) => [{ group: entity.data.role }],
    },
  ],
});
```

```tsx [app/members/page.tsx]
import { useEntities, createEntity } from 'monorise/react';
import { Entity } from '#/monorise/entities';

export default function MembersPage() {
  const { entities: members, searchField, isLoading } = useEntities(Entity.MEMBER);

  const handleCreate = async () => {
    await createEntity(Entity.MEMBER, {
      name: 'Alice',
      email: 'alice@example.com',
    });
  };

  return (
    <div>
      <input {...searchField} placeholder="Search members..." />
      <button onClick={handleCreate}>Add Member</button>
      {members?.map((m) => (
        <div key={m.entityId}>{m.data.name} — {m.data.email}</div>
      ))}
    </div>
  );
}
```

:::

That's it — API, DynamoDB, EventBridge, processors, and a type-safe frontend. [Get started →](/getting-started)
