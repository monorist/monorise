# Design Philosophy

Monorise is built around three core principles:

- Designed using a **single-table pattern** to deliver consistent `O(1)` performance for every query — regardless of size or complexity.
- The data model is **intentionally denormalized** to support this performance. While some data may be replicated, all duplication is managed automatically by Monorise, so developers don't have to worry about it.
- Built to feel **intuitive and familiar**, similar to querying a traditional relational database (like RDS), but with the scalability and speed of modern infrastructure.

## Core concepts

This system revolves around three core building blocks:

| Concept | Description |
|---------|-------------|
| [Entity](/concepts/entities) | A first-class record (e.g., `learner`, `course`) |
| [Mutual](/concepts/mutuals) | A relationship record between two entities that can hold data |
| [Tag](/concepts/tags) | A key/value access pattern to quickly query subsets of entities |

These are defined per entity in config files via `createEntityConfig` (Zod-based). Additionally, **Prejoins** are computed relationships that "join" through a chain of mutuals to avoid expensive multi-hop queries.
