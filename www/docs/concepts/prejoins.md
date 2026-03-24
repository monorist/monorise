# Prejoins

A **prejoin** is a computed relationship that "joins" through a chain of mutuals to avoid expensive multi-hop queries at read time. Instead of querying A → B → C at runtime, monorise precomputes the A → C relationship and stores it as a mutual.

::: warning Write-heavy
Prejoins are **write-heavy** — every time an intermediate entity changes, the prejoin processor must recompute the derived relationship. In most cases, you do **not** need prejoins. Only use them when you have a proven need to eliminate multi-hop reads.
:::

## When to use prejoins

Use prejoins when:
- You have a **chain of mutual relationships** (A → B → C) and frequently query A → C directly
- The **read frequency far exceeds write frequency** for the intermediate entities
- The alternative (multiple sequential API calls) creates unacceptable latency

Do **not** use prejoins when:
- You can tolerate two sequential API calls
- The intermediate entities change frequently (high write amplification)
- The chain is only two hops (a single `useMutuals` call is sufficient)
- You can add a **direct mutual field** instead (see below)

## Alternative: direct mutual fields

Before reaching for prejoins, consider whether you can simply add a direct mutual relationship. This is often the simpler and more efficient solution.

**Example:** You have three entities — `Tenant`, `Organisation`, and `Member`. A tenant has organisations, and organisations have members. You need to list all members by tenant.

**Without a direct mutual**, you'd need two calls:
1. Get all organisations for the tenant
2. For each organisation, get all members

**With prejoins**, monorise would compute `Tenant → Member` automatically — but this adds write overhead every time an organisation or member changes.

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
// All members for a tenant — no prejoins needed
const { mutuals: members } = useMutuals(Entity.TENANT, Entity.MEMBER, tenantId);
```

::: tip
If you know the relationship at creation time, a direct mutual field is always cheaper and simpler than a prejoin. Reserve prejoins for cases where the relationship is truly derived and cannot be known upfront.
:::

## When prejoins are necessary

Prejoins are the right choice when the A → C relationship **cannot be established at creation time** — it only emerges from the chain of intermediate relationships. For example, if members are assigned to classes, and classes are assigned to teachers, the teacher-member relationship is purely derived.

## Example

Imagine a school system where:

- `Teacher` has a mutual with `Class`
- `Class` has a mutual with `Student`

To show all students for a teacher, you'd normally need two queries:
1. Get all classes for the teacher
2. For each class, get all students

With a prejoin, monorise precomputes the `Teacher → Student` relationship:

```ts
const config = createEntityConfig({
  name: 'teacher',
  displayName: 'Teacher',
  baseSchema,
  mutual: {
    mutualSchema: z.object({
      classIds: z.string().array(),
    }).partial(),
    mutualFields: {
      classIds: {
        entityType: Entity.CLASS,
      },
    },
    prejoins: [
      {
        mutualField: 'classIds',
        targetEntityType: Entity.STUDENT,
        entityPaths: [
          {
            entityType: Entity.STUDENT,
            // optional: skipCache for real-time accuracy
            // skipCache: true,
          },
        ],
      },
    ],
  },
});
```

### How it works

1. When a `Teacher → Class` mutual changes, the prejoin processor is triggered
2. The processor walks the configured path: `Class → Student`
3. It publishes derived mutual events for `Teacher → Student`
4. These are processed as regular mutual records in DynamoDB

Now you can query `useMutuals(Entity.TEACHER, Entity.STUDENT, teacherId)` in a single call.

### Custom processors

Each entity path in a prejoin can have a custom `processor` function:

```ts
prejoins: [
  {
    mutualField: 'classIds',
    targetEntityType: Entity.STUDENT,
    entityPaths: [
      {
        entityType: Entity.STUDENT,
        processor: (items, context) => {
          // Filter or transform the joined items
          return {
            items: items.filter(item => item.data.isActive),
            context,
          };
        },
      },
    ],
  },
],
```

## Trade-offs

| Aspect | Without prejoins | With prejoins |
|--------|-----------------|---------------|
| Read latency | Multiple sequential calls | Single call |
| Write cost | Low | High (recomputation on every change) |
| Data freshness | Always current | Eventually consistent |
| Complexity | Simple | More moving parts |
| DynamoDB cost | Higher read capacity | Higher write capacity |
