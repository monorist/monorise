# Tags

Tags enable **additional access patterns** beyond the default entity list. While every entity can be listed and fetched by ID, tags let you query subsets of entities by group, sorted by a value — without scanning the entire table.

For example, without tags you can only do:
- List all organisations
- Get organisation by ID

With tags, you can also do:
- List all organisations **of type "club"**
- List all organisations **in a specific country, sorted by creation date**
- List all orders **with status "pending", sorted by amount**

Tags are powered by a **tag processor** that runs automatically whenever an entity is created or updated, keeping tag indexes in sync.

## Key characteristics

- Tags are attached to a **single type of entity**
- Each tag has a **name** and a processor that produces entries with optional `group` and `sortValue`
- An entity can have **multiple tags** across different dimensions
- Tags support **filtering by group** and **range queries on sortValue**
- The tag processor runs automatically on create/update — no manual indexing needed

## Defining tags

Tags are configured in your entity config. The `processor` function receives the entity and returns an array of tag entries.

### Group only (filter by category)

Use `group` when you want to filter entities by a category:

```ts
const config = createEntityConfig({
  name: 'organisation',
  displayName: 'Organisation',
  baseSchema,
  tags: [
    {
      name: 'type',
      processor: (entity) => {
        return [{ group: entity.data.type }];
      },
    },
  ],
});
```

This lets you query: *"Give me all organisations of type club"*

### Sort value only (range queries)

Use `sortValue` when you want to sort or query a range without grouping:

```ts
tags: [
  {
    name: 'created',
    processor: (entity) => {
      return [{ sortValue: entity.createdAt }];
    },
  },
],
```

This lets you query: *"Give me all organisations created between Jan and March 2025"*

### Group + sort value (filter and sort)

Combine both for filtered, sorted queries:

```ts
tags: [
  {
    name: 'region-activation',
    processor: (entity) => {
      return [
        {
          group: entity.data.region,
          sortValue: entity.data.activatedAt,
        },
      ];
    },
  },
],
```

This lets you query: *"Give me all organisations in eu-west-1, sorted by activation date"*

### Multiple entries per tag

A single processor can return multiple entries. For example, an order that belongs to multiple categories:

```ts
tags: [
  {
    name: 'status',
    processor: (entity) => {
      const entries = [{ group: entity.data.status }];
      // Also index by payment status
      if (entity.data.paymentStatus) {
        entries.push({ group: `payment-${entity.data.paymentStatus}` });
      }
      return entries;
    },
  },
],
```

## Querying tags (API)

```
GET /core/tag/:entityType/:tagName?group=...&start=...&end=...
```

| Parameter | Description |
|-----------|-------------|
| `group` | Filter by group value |
| `start` | Sort value range start (inclusive) |
| `end` | Sort value range end (inclusive) |
| `limit` | Max results per page |

Examples:

```
# All organisations of type "club"
GET /core/tag/organisation/type?group=club

# All organisations created in 2025
GET /core/tag/organisation/created?start=2025-01-01&end=2025-12-31

# Organisations in eu-west-1, activated after 2025-01-01
GET /core/tag/organisation/region-activation?group=eu-west-1&start=2025-01-01
```

## Querying tags (React)

Use the `useTaggedEntities` hook:

### Filter by group

```ts
// All organisations of type "club"
const { entities, isLoading } = useTaggedEntities(
  Entity.ORGANISATION,
  'type',
  { params: { group: 'club' } },
);
```

### Range query on sort value

```ts
// All organisations created in 2025
const { entities } = useTaggedEntities(
  Entity.ORGANISATION,
  'created',
  { params: { start: '2025-01-01', end: '2025-12-31' } },
);
```

### Group + sort range

```ts
// Organisations in eu-west-1, activated after 2025-01-01
const { entities } = useTaggedEntities(
  Entity.ORGANISATION,
  'region-activation',
  { params: { group: 'eu-west-1', start: '2025-01-01' } },
);
```

### Pagination

```ts
const { entities, lastKey, listMore, isLoading } = useTaggedEntities(
  Entity.ORGANISATION,
  'type',
  { params: { group: 'club' } },
);

// Load more when user scrolls to bottom
if (lastKey) {
  await listMore();
}
```

## Data layout

| Pattern | Key structure |
|---------|---------------|
| Tag record | `PK = TAG#<entityType>#<tagName>[#group]`, `SK = <sortValue?>#<entityType>#<entityId>` |
| Reverse lookup | By entity for cleanup/updates |
