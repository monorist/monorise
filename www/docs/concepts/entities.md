# Entities

An **entity** is a distinct, identifiable object or concept that can have data stored about it. Entities are the primary building blocks of your data model.

## Example

If you're modeling a bookstore, you might define entities such as:

- `book` — represents an item in your inventory
- `author` — represents a person who wrote a book
- `customer` — represents someone who buys books

## Defining an entity

Each entity is defined using `createEntityConfig` with a Zod schema:

```ts
import { createEntityConfig } from 'monorise/base';
import { z } from 'zod/v4';

const baseSchema = z
  .object({
    name: z.string().min(1),
    email: z.string().email(),
    role: z.enum(['admin', 'member']),
  })
  .partial();

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

const config = createEntityConfig({
  name: 'user',
  displayName: 'User',
  baseSchema,
  createSchema,
  searchableFields: ['name', 'email'],
  uniqueFields: ['email'],
});

export default config;
```

## Configuration fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Unique kebab-case identifier (e.g., `'user'`, `'learning-activity'`) |
| `displayName` | `string` | Yes | Human-readable name |
| `baseSchema` | `z.ZodObject` | Yes | All possible fields (`.partial()` for updates) |
| `createSchema` | `z.ZodObject` | No | Minimum required fields for creation |
| `searchableFields` | `string[]` | No | Fields indexed for text search |
| `uniqueFields` | `string[]` | No | Fields that must be unique per entity type |
| `mutual` | `object` | No | Mutual relationship configuration (see [Mutuals](/concepts/mutuals)) |
| `tags` | `array` | No | Tag access patterns (see [Tags](/concepts/tags)) |
| `adjustmentConstraints` | `object` | No | Bounds for numeric fields when using [`adjustEntity`](/react#adjustentity) |

## Unique fields

Fields listed in `uniqueFields` are enforced at the database level. If you try to create an entity with a duplicate unique field value, the API returns an error.

```ts
const config = createEntityConfig({
  name: 'user',
  displayName: 'User',
  baseSchema,
  uniqueFields: ['email'],
});
```

You can also query entities by unique field:

```
GET /core/entity/user/unique/email/alice@example.com
```

Or using the React hook:

```ts
const { entity } = useEntityByUniqueField(Entity.USER, 'email', 'alice@example.com');
```

## Searchable fields

Fields listed in `searchableFields` are indexed for text search. You can search via the `query` parameter:

```
GET /core/entity/user?query=alice
```

Or using the React hook:

```ts
const { entities, searchField } = useEntities(Entity.USER);

// Bind to an input
<input {...searchField} placeholder="Search users..." />
```

## Data layout

In DynamoDB, entities use these access patterns:

| Pattern | Key structure |
|---------|---------------|
| Entity metadata | `PK = <entityType>#<entityId>`, `SK = #METADATA#` |
| Entity list | `PK = LIST#<entityType>`, `SK = <entityType>#<entityId>` |
| Unique fields | `PK = UNIQUE#<field>#<value>`, `SK = <entityType>` |
