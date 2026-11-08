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
| `search` | `object` | No | Fields indexed by word, so `?query=` reads only matching entities (see [Search](#search)) |
| `searchableFields` | `string[]` | No | Fields `?query=` matches by scanning every entity (see [Search](#search)). Can't be combined with `search` |
| `uniqueFields` | `string[]` | No | Fields that must be unique per entity type |
| `mutual` | `object` | No | Mutual relationship configuration (see [Mutuals](/concepts/mutuals)) |
| `tags` | `array` | No | Tag access patterns (see [Tags](/concepts/tags)) |
| `adjustmentConditions` | `object` | No | Named conditions for [`adjustEntity`](/react#adjustentity) — enforces preconditions on numeric adjustments |
| `updateConditions` | `object` | No | Named conditions for [`editEntity`](/react#editentity) — enforces preconditions on updates |
| `allowLegacyWhere` | `boolean` | No | Opt in to accepting raw `$where` on `editEntity` (deprecated, disabled by default — see [Conditional updates](/react#editentity)) |
| `effect` | `function` | No | Applies a final Zod refinement to the merged entity schema |
| `ttl` | `object` | No | DynamoDB TTL config — see [TTL](#ttl-time-to-live) below |

## Conditional writes

Conditions are named, server-owned preconditions. The client sends only a condition name; Monorise resolves the condition to a DynamoDB condition expression and enforces it atomically.

```ts
const config = createEntityConfig({
  name: 'wallet',
  displayName: 'Wallet',
  baseSchema: z.object({
    balance: z.number(),
    status: z.enum(['pending', 'active', 'archived']),
  }).partial(),
  adjustmentConditions: {
    withdraw: (_data, adjustments) => ({
      balance: { $gte: Math.abs(adjustments.balance ?? 0) },
    }),
  },
  updateConditions: {
    activate: { status: { $eq: 'pending' } },
    archive: (_data) => ({ status: { $ne: 'archived' } }),
  },
});
```

`adjustmentConditions` receives `(data, adjustments)` and requires every `adjustEntity` call to name a condition when the config is present:

```ts
await adjustEntity(Entity.WALLET, walletId, { balance: -500 }, {
  condition: 'withdraw',
});
```

`updateConditions` receives `(data)` and is optional for `editEntity` calls:

```ts
await editEntity(Entity.WALLET, walletId, {
  status: 'active',
  $condition: 'activate',
});
```

If a named condition is unknown, or the entity has no matching condition config, the request is rejected. A condition that does not hold returns a conflict. Supported operators are `$eq`, `$ne`, `$gt`, `$lt`, `$gte`, `$lte`, `$exists`, and `$beginsWith`.

::: warning Legacy conditions
`adjustmentConstraints` and raw `$where` are deprecated compatibility mechanisms. `$where` is disabled by default; prefer named `adjustmentConditions` and `updateConditions` for all new code.
:::

## Advanced validation

Use `effect` when validation depends on the final merged entity schema rather than one individual field:

```ts
const config = createEntityConfig({
  name: 'invite',
  displayName: 'Invite',
  baseSchema,
  effect: (schema) => schema.refine(
    (data) => !data.expiresAt || !data.createdAt || data.expiresAt > data.createdAt,
    'expiresAt must be after createdAt',
  ),
});
```

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

## Search

Search entities with the `query` parameter:

```
GET /core/entity/user?query=alice
```

Or using the React hook:

```ts
const { entities, searchField } = useEntities(Entity.USER);

// Bind to an input
<input {...searchField} placeholder="Search users..." />
```

There are two ways to choose the fields a query matches. `search` indexes them by word, so a query reads only the entities that contain its words. `searchableFields` reads every entity of the type on each query, which gets slow and costly as the type grows. An entity uses one or the other.

### Indexed search (`search`)

```ts
const config = createEntityConfig({
  name: 'user',
  displayName: 'User',
  baseSchema,
  search: {
    fields: [{ field: 'name' }, { field: 'email' }],
  },
});
```

Each field value is split into words on spaces and symbols, lowercased and with accents removed: `"José Doe"` becomes `jose`, `doe`, and `"jose@mail.com"` becomes `jose`, `mail`, `com`. Arrays are split element by element, and numbers are matched as text.

| Query | Matches |
|-------|---------|
| `john doe` | Entities with a word starting with `john` and one starting with `doe`, in any order: "John Doe", "Doe John", "Johnny Doerr" |
| `"john doe"` | Only the exact text "john doe" in one field |
| `jane@mail.com` | Text joined by symbols must appear exactly, so `mail@jane.com` doesn't match |
| `lumbing` | Nothing in "plumbing": words match from their start |

A query needs a word of at least two letters, and matches are returned newest first. All matches are returned, so you can rank them in your app.

#### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `fields` | — | Fields to index, most-searched first. `match` defaults to `'words'`, the only mode for now |
| `maxWords` | `8` | Most words indexed per entity, filled from the first field on, after duplicates and ignored words are dropped. Words past it can't be found |
| `ignoreWords` | `DEFAULT_IGNORE_WORDS` | Words never indexed and skipped in queries (also known as stop words): `the`, `and`, `of`, `in`, `to`, `for`, … |

`maxWords` and `ignoreWords` can also be set for every entity in [`monorise.config.ts`](/getting-started#project-config-monorise-config-ts). An entity's setting replaces the global one, so extend a list by spreading it:

```ts
import { DEFAULT_IGNORE_WORDS } from 'monorise/base';

search: {
  fields: [{ field: 'companyName' }],
  ignoreWords: [...DEFAULT_IGNORE_WORDS, 'sdn', 'bhd'],
},
```

An ignored word can't be found on its own, so avoid words that are also names. Inside quotes it still counts as part of the phrase, and a last ignored word still matches as the start of a word while it's being typed (`and` finds "Anderson").

#### Cost

Each indexed word is a copy of the entity, kept in sync by the replication processor. Every update of an entity writes up to `maxWords` extra items, whichever field changed, and its storage grows the same way. A query reads the copies under its longest word, so a long word that most entities share (like "plumbing" in a directory of plumbers) reads more than a rare one.

#### Turning it on and changing it

On deploy, Monorise builds the index for existing entities whenever an entity's `search` config, or the global settings it uses, change. Until that finishes, queries on that type scan every entity, with the same results. New and updated entities are indexed as they're written.

If you remove `search` from every entity and add it back later with the same settings, the reindex function was removed in between and can't tell. Rebuild by hand after deploying:

```bash
aws lambda invoke --function-name <stage>-<app>-<id>-search-reindex \
  --payload '{"action":"start","force":true}' --cli-binary-format raw-in-base64-out /dev/null
```

### Scanned search (`searchableFields`)

```ts
searchableFields: ['name', 'email'],
```

Each query reads every entity of the type and matches the query, lowercased, anywhere in the listed fields. It needs no index and suits small types; switch to `search` as the type grows.

## TTL (time-to-live)

Use `ttl.processor` to have DynamoDB automatically delete an entity once it expires. The processor returns the expiry as epoch seconds or a `Date` — return `undefined` for no expiry.

```ts
const config = createEntityConfig({
  name: 'session',
  displayName: 'Session',
  baseSchema,
  ttl: {
    // fixed 30-day TTL from creation/each update
    processor: () => Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
  },
});
```

TTL can also be data-driven, computed from the entity's own fields:

```ts
const config = createEntityConfig({
  name: 'invite',
  displayName: 'Invite',
  baseSchema,
  ttl: {
    processor: (entity) => {
      return entity.data.expiresOn
        ? new Date(entity.data.expiresOn)
        : undefined;
    },
  },
});
```

`processor` is called again on every update/upsert, using the entity's data as it will be *after* the update is applied — so a sliding-expiration TTL (e.g. extending a session on activity) works out of the box. If `processor` returns `undefined` on an update, any existing `expiresAt` is left untouched rather than cleared.

Internally, this always writes to an `expiresAt` attribute — the same attribute name the DynamoDB table's TTL is configured on (see [SST SDK](/sst)), so there's nothing else to wire up.

## Transactional writes

Multiple entity operations can be executed atomically using the [`transaction`](/react#transaction) API. All operations succeed or all fail — no partial writes.

```ts
import { coreService, transactional } from 'monorise/react';

await coreService.transaction([
  transactional.createEntity('order', { ... }),
  transactional.adjustEntity('wallet', '...', { balance: -100, $condition: 'withdraw' }),
]);
```

Supported operations: `createEntity`, `updateEntity`, `adjustEntity`, `deleteEntity`, `createMutual`, `updateMutual`, `deleteMutual`. Conditions from `adjustmentConditions` and `updateConditions` are supported within transactions, so a link can change in step with a guarded counter (see [`transaction`](/react#transaction)). Events are published only after the transaction commits.

## Data layout

In DynamoDB, entities use these access patterns:

| Pattern | Key structure |
|---------|---------------|
| Entity metadata | `PK = <entityType>#<entityId>`, `SK = #METADATA#` |
| Entity list | `PK = LIST#<entityType>`, `SK = <entityType>#<entityId>` |
| Unique fields | `PK = UNIQUE#<field>#<value>`, `SK = <entityType>` |
| Search index | `PK = SEARCH#<entityType>`, `SK = <word>#<entityId>` |
