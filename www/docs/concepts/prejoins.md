# Tree Processors

A **tree processor** computes a relationship by traversing a chain of mutuals, avoiding expensive multi-hop queries at read time. Instead of querying A → B → C at runtime, Monorise computes the A → C relationship and stores it as a mutual.

::: info Configuration name
Tree processors were previously described as prejoins. The public configuration key remains `mutual.prejoins` for backward compatibility.
:::

::: warning Write-heavy
Tree processors are **write-heavy** — when a subscribed relationship changes, the tree processor recomputes the derived relationship. In most cases, you do **not** need a tree processor. Only use one when you have a proven need to eliminate multi-hop reads.
:::

## When to use tree processors

Use tree processors when:
- You have a **chain of mutual relationships** (A → B → C) and frequently query A → C directly
- The **read frequency far exceeds change frequency** for the subscribed relationships
- The alternative (multiple sequential API calls) creates unacceptable latency

Do **not** use tree processors when:
- You can tolerate two sequential API calls
- The intermediate relationships change frequently (high write amplification)
- The relationship is already direct (a single `useMutuals` call is sufficient)
- You can add a **direct mutual field** instead (see below)

## Alternative: direct mutual fields

Before reaching for a tree processor, consider whether you can simply add a direct mutual relationship. This is often the simpler and more efficient solution.

**Example:** You have three entities — `Tenant`, `Organisation`, and `Member`. A tenant has organisations, and organisations have members. You need to list all members by tenant.

**Without a direct mutual**, you'd need two calls:
1. Get all organisations for the tenant
2. For each organisation, get all members

**With a tree processor**, Monorise would compute `Tenant → Member` automatically — but this adds write overhead every time a subscribed relationship changes.

**Better approach:** Add `tenantIds` as a mutual field directly on `Member`:

```ts
const config = createEntityConfig({
  name: 'member',
  displayName: 'Member',
  baseSchema,
  mutual: {
    mutualSchema: z
      .object({
        organisationIds: z.string().array(),
        tenantIds: z.string().array(), // direct link to tenant
      })
      .partial(),
    mutualFields: {
      organisationIds: { entityType: Entity.ORGANISATION },
      tenantIds: { entityType: Entity.TENANT },
    },
  },
});
```

When creating a member, pass both IDs:

```ts
await createEntity(Entity.MEMBER, {
  name: 'Alice',
  organisationIds: [organisationId],
  tenantIds: [tenantId],
});
```

Now you can query directly in a single call:

```ts
// All members for a tenant — no tree processor needed
const { mutuals: members } = useMutuals(Entity.TENANT, Entity.MEMBER, tenantId);
```

::: tip
If you know the relationship at creation time, a direct mutual field is always cheaper and simpler than a tree processor. Reserve tree processors for relationships that are truly derived and cannot be known upfront.
:::

## When tree processors are necessary

Tree processors are the right choice when the A → C relationship **cannot be established at creation time** — it only emerges from the chain of intermediate relationships. For example, if students are assigned to classes, and classes are assigned to teachers, the teacher-student relationship is purely derived.

## Example

Imagine a school system where:

- `Teacher` has a mutual with `Class`
- `Class` has a mutual with `Student`

To show all students for a teacher, you'd normally need two queries:
1. Get all classes for the teacher
2. For each class, get all students

With a tree processor, Monorise computes the `Teacher → Student` relationship:

```ts
const config = createEntityConfig({
  name: 'teacher',
  displayName: 'Teacher',
  baseSchema,
  mutual: {
    // Trigger this tree when the Teacher → Class relationship changes.
    subscribes: [{ entityType: Entity.CLASS }],
    mutualSchema: z.object({
      classIds: z.string().array(),
    }).partial(),
    mutualFields: {
      classIds: {
        entityType: Entity.CLASS,
      },
    },
    // `prejoins` remains the public configuration key.
    prejoins: [
      {
        mutualField: 'classIds',
        targetEntityType: Entity.STUDENT,
        entityPaths: [
          // Start with the source entity, then describe each traversal step.
          { entityType: Entity.TEACHER },
          { entityType: Entity.CLASS },
          { entityType: Entity.STUDENT },
        ],
      },
    ],
  },
});
```

### How it works

1. When a `Teacher → Class` mutual changes, the tree processor is triggered
2. The processor walks the configured path: `Teacher → Class → Student`
3. It publishes derived mutual events for `Teacher → Student`
4. These are processed as regular mutual records in DynamoDB

Now you can query `useMutuals(Entity.TEACHER, Entity.STUDENT, teacherId)` in a single call.

### Custom processors

Each entity path in a tree processor can have a custom `processor` function:

```ts
prejoins: [
  {
    mutualField: 'classIds',
    targetEntityType: Entity.STUDENT,
    entityPaths: [
      { entityType: Entity.TEACHER },
      { entityType: Entity.CLASS },
      {
        entityType: Entity.STUDENT,
        processor: (items, context) => {
          // Filter or transform the joined items
          return {
            items: items.filter(item => item.mutualData.isActive),
            context,
          };
        },
      },
    ],
  },
],
```

By default, a tree processor reuses an entity type already traversed during the same invocation. Set `skipCache: true` on a path only when that type must be traversed again. It does not make asynchronous processing real-time.

## Trade-offs

| Aspect | Without tree processors | With tree processors |
|--------|-------------------------|----------------------|
| Read latency | Multiple sequential calls | Single call |
| Write cost | Low | High (recomputation on subscribed relationship changes) |
| Data freshness | No additional derived projection | Eventually consistent derived projection |
| Complexity | Simple | More moving parts |
| DynamoDB cost | Higher read capacity | Higher write capacity |
