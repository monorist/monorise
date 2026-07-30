# Tree Processors

A **tree processor** is an event-driven traversal of mutual relationships. It materializes a derived direct mutual so a multi-hop relationship can be read with one query.

The configuration key is currently `mutual.prejoins` for compatibility. Older documentation and runtime names may call this feature a *prejoin*.

```text
Teacher -> Class -> Student
   |                    ^
   +-- tree processor --+

Stored result: Teacher -> Student
```

::: warning Write-heavy
Tree processors trade read latency for asynchronous write work. Every source relationship change can traverse the configured path and update derived mutuals. Use one only after a direct mutual is not possible and multi-hop reads are a demonstrated bottleneck.
:::

## Choose a direct relationship first

If you know a relationship at creation time, model it directly instead of deriving it. For example, if every `Member` already knows its tenant, store `tenantIds` alongside `organisationIds` and query `Tenant -> Member` directly.

```ts
mutual: {
  mutualSchema: z.object({
    organisationIds: z.string().array(),
    tenantIds: z.string().array(),
  }).partial(),
  mutualFields: {
    organisationIds: { entityType: Entity.ORGANISATION },
    tenantIds: { entityType: Entity.TENANT },
  },
},
```

Use a tree processor only when the final relationship emerges from other relationships, such as students being assigned to classes and classes being assigned to teachers.

## Configure a tree processor

This configuration derives `Teacher -> Student` from `Teacher -> Class -> Student`:

```ts
const config = createEntityConfig({
  name: 'teacher',
  displayName: 'Teacher',
  baseSchema,
  mutual: {
    // Run when the Teacher -> Class relationship changes.
    subscribes: [{ entityType: Entity.CLASS }],
    mutualSchema: z.object({
      classIds: z.string().array(),
    }).partial(),
    mutualFields: {
      classIds: { entityType: Entity.CLASS },
    },
    // `prejoins` remains the public configuration key.
    prejoins: [
      {
        mutualField: 'classIds',
        targetEntityType: Entity.STUDENT,
        entityPaths: [
          // The source is included first; it is already cached by the processor.
          { entityType: Entity.TEACHER },
          { entityType: Entity.CLASS },
          { entityType: Entity.STUDENT },
        ],
      },
    ],
  },
});
```

The processor:

1. Receives the `Teacher -> Class` relationship update.
2. Traverses the path from the cached teacher through classes to students.
3. Publishes an update for the derived `Teacher -> Student` mutual.
4. Materializes that mutual asynchronously, so `useMutuals(Entity.TEACHER, Entity.STUDENT, teacherId)` becomes a direct read.

### Path processors and cache control

Each path step can filter or transform the mutuals discovered at that step:

```ts
{
  entityType: Entity.STUDENT,
  processor: (items, context) => ({
    items: items.filter((item) => item.data.isActive),
    context,
  }),
}
```

By default, a tree processor reuses a relationship type it has already traversed during that invocation. Set `skipCache: true` on a path step only when the traversal must revisit that type. It does not change EventBridge/SQS delivery or make the derived relationship real-time.

## Trade-offs

| Aspect | Direct mutual | Tree processor |
|--------|---------------|----------------|
| Read path | One mutual query | One mutual query after materialization |
| Write cost | Low | Higher due to traversal and derived writes |
| Freshness | Direct relationship state | Eventually consistent derived state |
| Use when | Relationship is known at write time | Relationship is genuinely derived |
