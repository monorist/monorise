---
layout: home

hero:
  name: Monorise
  text: DynamoDB Single-Table Toolkit
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
