# React SDK

The React SDK (`monorise/react`) provides hooks, actions, and services for building frontend applications with monorise. It features built-in caching, optimistic updates, and type-safe data access.

::: warning
Never point the React SDK directly at the monorise API Gateway. Always proxy through your frontend server using the [edge-auth proxy pattern](/best-practices#always-proxy-api-requests-through-your-server).
:::

## Setup

```ts
import { initMonorise } from 'monorise/react';

const monorise = initMonorise();
export const {
  useEntities,
  useEntity,
  useMutuals,
  useTaggedEntities,
  createEntity,
  editEntity,
  // ... all exports
} = monorise;
```

## Caching

All data-fetching hooks use a Zustand-based store with an **`isFirstFetched`** pattern:

- On first render, the hook fetches data from the API and sets `isFirstFetched = true`
- On subsequent renders (re-mounts, navigation), the hook returns cached data **instantly** without another API call
- Cache is per-key: entity type, mutual state key, or tag state key
- Cache persists for the entire session (page refresh clears it)
- Use `forceFetch` option or the `refetch` function to bypass cache

```ts
// First render: fetches from API
const { entities } = useEntities(Entity.USER);

// Navigate away and come back: returns cached data instantly
const { entities } = useEntities(Entity.USER);
```

Two ways to force a fresh fetch:

```ts
// Option 1: Call refetch() — useful for user-triggered refresh (e.g., pull-to-refresh)
const { entities, refetch } = useEntities(Entity.USER);
refetch();

// Option 2: Pass forceFetch option — useful when you always want fresh data on mount
const { entities } = useEntities(Entity.USER, { forceFetch: true });
```

The `forceFetch` option works on all data-fetching hooks (`useEntities`, `useEntity`, `useMutuals`, `useTaggedEntities`, etc.).

## Optimistic updates

Monorise provides `*Local*` functions that update the UI immediately before the server responds. This makes the app feel instant.

```ts
// Server action — waits for response
await createEntity(Entity.USER, { name: 'Alice' });

// Optimistic — updates UI immediately, no server call
updateLocalEntity(Entity.USER, userId, { name: 'Alice (edited)' });
```

Optimistic functions use [Immer](https://immerjs.github.io/immer/) for immutable state updates and update both sides of mutual relationships automatically.

---

## Hooks

All data-fetching hooks accept an optional `opts` parameter (`CommonOptions`) and return a consistent set of properties:

### Common options

```ts
{
  forceFetch?: boolean;       // bypass cache and always fetch from API
  isInterruptive?: boolean;   // show interruptive loading indicator
  limit?: number;             // max results per page (default: 20)
  customUrl?: string;         // override the default API URL
  stateKey?: string;          // custom store state key
  feedback?: {
    success?: string;         // toast message on success
    failure?: string;         // toast message on failure
    loading?: string;         // toast message while loading
  };
}
```

### Common return properties

Every data-fetching hook returns at least:

| Property | Type | Description |
|----------|------|-------------|
| `isLoading` | `boolean` | Whether a request is in flight |
| `isFirstFetched` | `boolean` | Whether data has been fetched at least once |
| `error` | `ApplicationRequestError \| undefined` | Error from the last request |
| `requestKey` | `string` | Unique key for this request (useful with `useLoadStore`/`useErrorStore`) |
| `refetch` | `() => Promise<...>` | Force a fresh fetch from the API |

List hooks additionally return:

| Property | Type | Description |
|----------|------|-------------|
| `lastKey` | `string \| undefined` | Pagination cursor — present when more data is available |
| `listMore` | `() => void` | Load next page of results |

### `useEntities`

Fetch a list of entities with search and pagination.

```ts
const {
  entities,        // CreatedEntity<T>[]
  entitiesMap,     // Map<string, CreatedEntity<T>>
  isLoading,
  isFirstFetched,
  error,
  searchField,     // { value: string, onChange: (e) => void }
  lastKey,
  listMore,
  refetch,
  requestKey,
} = useEntities(Entity.USER, { limit: 100 }, opts?);
```

The second argument accepts `{ limit?, all?, skRange? }`. The `limit` controls how many entities are fetched per page (default: 20). `listMore` respects the same limit.

```ts
// Fetch all entities (no limit)
const { entities } = useEntities(Entity.USER, { all: true });

// Fetch with custom page size
const { entities, listMore } = useEntities(Entity.USER, { limit: 50 });
```

The `searchField` helper can be bound directly to an input:

```tsx
<input {...searchField} placeholder="Search users..." />
```

### `useEntity`

Fetch a single entity by ID.

```ts
const {
  entity,          // CreatedEntity<T> | undefined
  isLoading,
  isFirstFetched,
  error,
  refetch,
  requestKey,
} = useEntity(Entity.USER, userId, opts?);
```

### `useEntityByUniqueField`

Fetch an entity by a unique field value (e.g., email).

```ts
const {
  entity,          // CreatedEntity<T> | undefined
  isLoading,
  isFirstFetched,
  error,
  refetch,
  requestKey,
} = useEntityByUniqueField(Entity.USER, 'email', 'alice@example.com', opts?);
```

### `useMutuals`

Fetch entities related to a given entity via mutual relationships.

```ts
const {
  mutuals,         // Mutual<B, T>[]
  mutualsMap,      // Map<string, Mutual<B, T>>
  isLoading,
  isFirstFetched,
  error,
  lastKey,
  listMore,
  refetch,
  requestKey,
} = useMutuals(Entity.TENANT, Entity.ORGANISATION, tenantId, opts?);
```

Each `mutual` object contains:

```ts
{
  entityId: string;        // the related entity's ID
  entityType: Entity;      // the related entity's type
  byEntityId: string;      // the source entity's ID
  byEntityType: Entity;    // the source entity's type
  mutualId: string;
  data: EntitySchemaMap[T]; // the related entity's data (strongly typed)
  mutualData: Record<string, any>; // relationship-specific data
  createdAt: string;
  updatedAt: string;
  mutualUpdatedAt: string;
}
```

### `useMutual`

Fetch a single mutual relationship.

```ts
const {
  mutual,          // Mutual<B, T> | undefined
  isLoading,
  isFirstFetched,
  error,
  refetch,
  requestKey,
} = useMutual(Entity.TENANT, Entity.ORGANISATION, tenantId, organisationId, opts?);
```

### `useTaggedEntities`

Fetch entities by tag with optional group and sort range filters.

```ts
const {
  entities,        // CreatedEntity<T>[]
  entitiesMap,     // Map<string, CreatedEntity<T>>
  isLoading,
  isFirstFetched,
  error,
  lastKey,
  listMore,
  refetch,
  requestKey,
} = useTaggedEntities(Entity.ORGANISATION, 'type', {
  ...opts?,
  params: { group: 'club' },
});
```

### `useEntityState`

Access raw entity store state for a given entity type.

```ts
const entityState = useEntityState(Entity.USER);
```

### Utility hooks

| Hook | Purpose |
|------|---------|
| `useConfig` | Access entity configuration |
| `useLoadStore(requestKey)` | Loading state for a specific request |
| `useErrorStore(requestKey)` | Error state for a specific request |
| `useModalStore` | Modal open/close state |

---

## Actions

### Entity actions

| Action | Description |
|--------|-------------|
| `createEntity(entityType, data, opts?)` | Create entity on server. Returns `{ data }` or `{ error }`. |
| `editEntity(entityType, id, data, opts?)` | Partial update entity (sets fields to exact values). For incrementing/decrementing numbers, use [`adjustEntity`](#adjustentity) instead. Returns `{ data }` or `{ error }`. |
| `adjustEntity(entityType, id, adjustments, opts?)` | Safely increment/decrement numeric fields. Returns `{ data }` or `{ error }`. |
| `upsertEntity(entityType, id, data, opts?)` | Insert or full replace. Returns `{ data }` or `{ error }`. |
| `deleteEntity(entityType, id, opts?)` | Delete entity. Returns `{ data }` or `{ error }`. |
| `getEntity(entityType, id)` | Fetch single entity (non-hook). |
| `listMoreEntities(entityType, opts?)` | Load next page of entities. |

### `editEntity`

Partially update an entity by setting fields to exact values.

```ts
import { editEntity } from 'monorise/react';

await editEntity(Entity.USER, userId, {
  name: 'Alice Smith',
  role: 'admin',
});
```

Only the fields you pass are updated — other fields remain unchanged. The updated entity propagates to mutual and tag stores automatically.

::: tip
If you need to increment or decrement a numeric field (e.g., a counter or running total), use [`adjustEntity`](#adjustentity) instead. `editEntity` sets the field to the value you provide, which can cause data loss if multiple updates happen concurrently.
:::

**Conditional updates**: Use `$condition` to enforce a precondition defined in `updateConditions`:

```ts
// Entity config
const config = createEntityConfig({
  name: 'post',
  baseSchema,
  updateConditions: {
    publish: { status: { $eq: 'draft' } },
    archive: (data) => ({ status: { $ne: 'archived' } }),
  },
});

// Only publishes if current status is 'draft'
await editEntity(Entity.POST, postId, {
  status: 'published',
  $condition: 'publish',
});
```

`$condition` is always **optional** for `editEntity` — omitting it performs an unconditioned update (current behavior). If the condition is not met, the API returns a 409 Conflict error.

### `adjustEntity`

Safely increment or decrement numeric fields on an entity. Unlike `editEntity` which sets a field to a specific value, `adjustEntity` adds or subtracts a delta — meaning multiple concurrent adjustments never overwrite each other.

**Why not `editEntity`?** Imagine two requests try to increment a counter from 100 at the same time:
- With `editEntity`: both read 100, both write 101. You lose one increment.
- With `adjustEntity`: both send "+1". The result is 102. No data loss.

Use `adjustEntity` for counters, running totals, scores, or any field that multiple sources update concurrently.

```ts
import { adjustEntity } from 'monorise/react';

// Increment sales by $50.00 and count by 1
await adjustEntity(Entity.MONTHLY_SUMMARY, summaryId, {
  totalSales: 5000,
  count: 1,
});

// Decrement (use negative values)
await adjustEntity(Entity.MONTHLY_SUMMARY, summaryId, {
  totalRefunds: -2000,
});
```

**Type safety**: Only accepts numeric fields from the entity schema. Passing a string field results in a TypeScript error.

**No optimistic update**: Unlike `editEntity`, the local cache is only updated after the server confirms success. This is because adjustments may fail (condition violations) or produce different results than expected (concurrent adjustments).

**Conditions**: Define `adjustmentConditions` in your entity config to enforce preconditions on adjustments. When defined, the `condition` option is **required** — you must specify which condition to apply.

Each condition is either a static check or a function that receives the entity's current data and the adjustment deltas:

```ts
const config = createEntityConfig({
  name: 'wallet',
  baseSchema: z.object({
    balance: z.number(),
    minBalance: z.number(),
  }).partial(),
  adjustmentConditions: {
    // Dynamic: uses entity data + adjustment deltas
    withdraw: (data, adjustments) => ({
      balance: { $gte: (data.minBalance ?? 0) + Math.abs(adjustments.balance ?? 0) },
    }),
    // Ensures post-deposit balance doesn't exceed cap
    deposit: (data, adjustments) => ({
      balance: { $lte: 1000000 - (adjustments.balance ?? 0) },
    }),
  },
});
```

Pass the condition name when calling `adjustEntity`:

```ts
// This succeeds (balance: 100, withdraw checks balance >= 0 + 30 = 30 → 100 >= 30 ✓)
await adjustEntity(Entity.WALLET, id, { balance: -30 }, { condition: 'withdraw' });

// This fails (balance: 70, withdraw checks balance >= 0 + 80 = 80 → 70 < 80 ✗)
const { error } = await adjustEntity(Entity.WALLET, id, { balance: -80 }, {
  condition: 'withdraw',
});
if (error) {
  // entity is automatically refetched with latest state
  // show "Insufficient balance" to user
}
```

Conditions are resolved **server-side** — the client only sends the condition name, never raw operators. This prevents clients from bypassing or modifying the condition logic.

Supported operators in conditions: `$eq`, `$ne`, `$gt`, `$lt`, `$gte`, `$lte`, `$exists`, `$beginsWith`.

Conditions are enforced at the database level via DynamoDB ConditionExpressions — they cannot be bypassed by the frontend.

**Event publishing**: Publishes `ENTITY_UPDATED` event, so tag and replication processors keep denormalized data in sync — same as `editEntity`.

### `transaction`

Execute multiple entity operations atomically — all succeed or all fail. Uses DynamoDB `TransactWriteItems` under the hood.

```ts
import { transaction } from 'monorise/react';

await transaction([
  {
    operation: 'createEntity',
    entityType: Entity.ORDER,
    payload: { customerId: '...', total: 5000 },
  },
  {
    operation: 'adjustEntity',
    entityType: Entity.WALLET,
    entityId: walletId,
    adjustments: { balance: -5000 },
    condition: 'withdraw',
  },
]);
```

**Supported operations:**

| Operation | Description |
|-----------|-------------|
| `createEntity` | Create a new entity (with unique field enforcement) |
| `updateEntity` | Partial update (no unique field changes allowed in transactions) |
| `adjustEntity` | Atomic numeric increment/decrement (with condition support) |
| `deleteEntity` | Delete an entity |

**Conditions**: `adjustEntity` and `updateEntity` support the `condition` field, referencing `adjustmentConditions` or `updateConditions` defined in the entity config.

**DynamoDB limits**: Maximum 100 items per transaction. Each `createEntity` uses 2+ items (main record + list index + unique fields). Other operations use 1 item each.

**Atomicity**: If any operation fails (condition violation, duplicate unique field, missing entity for delete), the entire transaction is rolled back — no partial writes.

**Events**: Events (`ENTITY_CREATED`, `ENTITY_UPDATED`, `ENTITY_DELETED`) are published only after the transaction commits successfully. Replication, tag, and mutual processors work normally.

### Mutual actions

| Action | Description |
|--------|-------------|
| `createMutual(byType, entityType, byId, entityId, payload?, opts?)` | Create mutual relationship. |
| `editMutual(byType, entityType, byId, entityId, payload, opts?)` | Update mutual data. |
| `deleteMutual(byType, entityType, byId, entityId, opts?)` | Delete mutual relationship. |
| `getMutual(byType, entityType, byId, entityId)` | Fetch single mutual (non-hook). |



### Auto-propagation

When you call `createEntity`, `editEntity`, or `deleteEntity`, the store automatically propagates changes to related stores:

- **Create**: New entity is added to matching tag stores and mutual stores (based on `mutualFields` in the entity config)
- **Edit**: Updated data propagates to mutual stores (both sides) and tag stores
- **Delete**: Entity is removed from all mutual and tag stores

This means `useMutuals` and `useTaggedEntities` reflect changes immediately without a manual refetch.

