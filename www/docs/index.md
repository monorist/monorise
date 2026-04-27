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

## Why Monorise?

<div class="features-grid">
  <div class="feature">
    <h3><span class="feature-icon">&#x1F5C4;&#xFE0F;</span> Single-Table DynamoDB</h3>
    <p>One table, O(1) performance for every query. Monorise handles denormalization and replication automatically.</p>
  </div>
  <div class="feature">
    <h3><span class="feature-icon">&#x1F504;</span> Zero Schema Drift</h3>
    <p>One Zod config drives your entire stack. Edit &rarr; save &rarr; types regenerate instantly. DB, backend, and frontend stay perfectly in sync.</p>
  </div>
  <div class="feature">
    <h3><span class="feature-icon">&#x1F680;</span> Ship in Hours, Not Weeks</h3>
    <p>From <code>git init</code> to production API in minutes. No migration scripts. No access pattern spreadsheets. No hand-rolled GSI headaches.</p>
  </div>
  <div class="feature">
    <h3><span class="feature-icon">&#x1F517;</span> Relational Access Patterns</h3>
    <p>Entity, Mutual, and Tag concepts give you relational-style queries on DynamoDB without complex hand-written expressions.</p>
  </div>
  <div class="feature">
    <h3><span class="feature-icon">&#x1F4E6;</span> Full-Stack SDK</h3>
    <p>Backend API (Hono), React hooks with caching, SST v3 infrastructure module — one package covers the entire stack.</p>
  </div>
  <div class="feature">
    <h3><span class="feature-icon">&#x1F6E0;&#xFE0F;</span> Seamless Dev Workflow</h3>
    <p>Run <code>npx sst dev</code> and everything just works — handlers, types, and Lambda entry points are auto-generated as you edit entity configs.</p>
  </div>
  <div class="feature">
    <h3><span class="feature-icon">&#x1F9E0;</span> Token-Efficient Development</h3>
    <p>No re-implementing CRUD boilerplate or DynamoDB patterns. One config gives you API, types, and processors — less code, fewer tokens, faster shipping.</p>
  </div>
</div>

<style>
.features-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
  margin-top: 24px;
}
@media (max-width: 768px) {
  .features-grid {
    grid-template-columns: 1fr;
  }
}
.feature {
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  padding: 24px;
  transition: border-color 0.25s;
}
.feature:hover {
  border-color: var(--vp-c-brand-1);
}
.feature-icon {
  margin-right: 8px;
}
.feature h3 {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 8px 0;
}
.feature p {
  font-size: 14px;
  color: var(--vp-c-text-2);
  margin: 0;
  line-height: 1.6;
}
</style>
