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
} = useEntities(Entity.USER, opts?);
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
| `editEntity(entityType, id, data, opts?)` | Partial update entity. Returns `{ data }` or `{ error }`. |
| `upsertEntity(entityType, id, data, opts?)` | Insert or full replace. Returns `{ data }` or `{ error }`. |
| `deleteEntity(entityType, id, opts?)` | Delete entity. Returns `{ data }` or `{ error }`. |
| `getEntity(entityType, id)` | Fetch single entity (non-hook). |
| `listMoreEntities(entityType, opts?)` | Load next page of entities. |

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

---

## WebSocket Hooks

Monorise provides WebSocket hooks for real-time updates. These are documented in detail on the [WebSocket](/websocket) page.

| Hook | Purpose |
|------|---------|
| `useEntityFeed(opts)` | Graph-aware real-time feed for an entity — recommended for most apps |
| `useEntitySocket(entityType, opts?)` | Subscribe to all CRUD events for an entity type |
| `useMutualSocket(byType, byId, entityType, opts?)` | Subscribe to mutual changes for a specific entity pair |
| `useEphemeralSocket(channel, opts?)` | Non-persisted messages (typing indicators, presence) |

The feed hook auto-updates the same stores that `useEntities` and `useMutuals` read from — no new API to learn.

