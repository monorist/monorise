# React SDK

The React SDK (`monorise/react`) provides hooks, actions, and services for building frontend applications with monorise. It features built-in caching, optimistic updates, and type-safe data access.

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

// Force a fresh fetch
const { refetch } = useEntities(Entity.USER);
refetch();
```

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

### `useEntities`

Fetch a list of entities with search and pagination.

```ts
const {
  entities,        // CreatedEntity<T>[]
  entitiesMap,     // Map<string, CreatedEntity<T>>
  isLoading,       // boolean
  isFirstFetched,  // boolean
  error,           // ApplicationRequestError | undefined
  searchField,     // { value: string, onChange: (e) => void }
  lastKey,         // string | undefined (pagination cursor)
  listMore,        // () => void — load next page
  refetch,         // () => void — force refresh
  requestKey,      // string
} = useEntities(Entity.USER);
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
  isLoading,       // boolean
  isFirstFetched,  // boolean
  error,           // ApplicationRequestError | undefined
  refetch,         // () => Promise<CreatedEntity<T> | undefined>
  requestKey,      // string
} = useEntity(Entity.USER, userId);
```

### `useEntityByUniqueField`

Fetch an entity by a unique field value (e.g., email).

```ts
const { entity, isLoading } = useEntityByUniqueField(
  Entity.USER,
  'email',
  'alice@example.com',
);
```

### `useMutuals`

Fetch entities related to a given entity via mutual relationships.

```ts
const {
  mutuals,         // Mutual<B, T>[]
  mutualsMap,      // Map<string, Mutual<B, T>>
  isLoading,       // boolean
  isFirstFetched,  // boolean
  error,           // ApplicationRequestError | undefined
  lastKey,         // string | undefined
  listMore,        // () => void
  refetch,         // () => Promise<...>
  requestKey,      // string
} = useMutuals(Entity.TENANT, Entity.ORGANISATION, tenantId);
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
const { mutual, isLoading, error } = useMutual(
  Entity.TENANT,
  Entity.ORGANISATION,
  tenantId,
  organisationId,
);
```

### `useTaggedEntities`

Fetch entities by tag with optional group and sort range filters.

```ts
const {
  entities,        // CreatedEntity<T>[]
  entitiesMap,     // Map<string, CreatedEntity<T>>
  isLoading,       // boolean
  isFirstFetched,  // boolean
  lastKey,         // string | undefined
  listMore,        // () => Promise<...>
  refetch,         // () => Promise<...>
  requestKey,      // string
} = useTaggedEntities(Entity.ORGANISATION, 'type', {
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
| `useProfile` | Current user profile |
| `useIsUnauthorized` | Auth status check |
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

### Optimistic update actions

These update the local store immediately without making API calls. Use them for instant UI feedback.

| Action | Description |
|--------|-------------|
| `updateLocalEntity(entityType, id, data?)` | Update entity in local store. |
| `createLocalMutual(byType, entityType, byId, entityId, mutualData, data)` | Add mutual to local store (both sides). |
| `upsertLocalMutual(byType, entityType, byId, entityId, mutualData, data?)` | Upsert mutual in local store. |
| `deleteLocalMutual(byType, entityType, byId, entityId)` | Remove mutual from local store (both sides). |
| `updateLocalTaggedEntity(tagKey, entity)` | Update entity in tag store. |
| `deleteLocalTaggedEntity(tagKey, entityId)` | Remove entity from tag store. |

### Auto-propagation

When you call `createEntity`, `editEntity`, or `deleteEntity`, the store automatically propagates changes to related stores:

- **Create**: New entity is added to matching tag stores and mutual stores (based on `mutualFields` in the entity config)
- **Edit**: Updated data propagates to mutual stores (both sides) and tag stores
- **Delete**: Entity is removed from all mutual and tag stores

This means `useMutuals` and `useTaggedEntities` reflect changes immediately without a manual refetch.

### Auth actions

| Action | Description |
|--------|-------------|
| `requestLogin(entityType, email, opts?)` | Trigger login flow |
| `logout()` | Log out current user |
| `getProfile(entityType, opts?)` | Fetch user profile |

### UI actions

| Action | Description |
|--------|-------------|
| `openModal(name, props?)` | Open a modal by name |
| `closeModal()` | Close the current modal |
| `setConfig(config)` | Set entity configuration |

---

## Services

| Service | Description |
|---------|-------------|
| `store` | Raw Zustand store instance |
| `axios` | Configured axios instance with auth interceptors |
| `authService` | Authentication service |
| `filestoreService` | File upload/storage service |
| `coreService` | Core entity/mutual/tag API service |
