# Monorise Roadmap — Future Enhancements

This document captures potential improvements and enhancements for monorise, organized by area.

---

## 1. Config-Based API Proxy (`monorise/next`)

**Problem:** Every monorise project needs a `[...proxy]/route.ts` and `proxy-request.ts` in the Next.js app. These files are nearly identical across projects — they rewrite URLs, forward headers, and attach the `x-api-key` header. This is boilerplate that shouldn't exist.

**Proposal:** Create a `monorise/next` package that exports a proxy route handler factory:

```typescript
// app/api/[...proxy]/route.ts
import { createProxyHandler } from 'monorise/next';

export const { GET, POST, PATCH, PUT, DELETE, OPTIONS } = createProxyHandler({
  apiKey: process.env.API_KEY || 'secret1',
  beforeRequest: async (req) => {
    // Optional: auth validation, token extraction
    // Return modified headers or throw to reject
  },
  afterResponse: async (req, res) => {
    // Optional: analytics, logging
  },
});
```

**Benefits:**
- Zero boilerplate proxy setup
- `API_BASE_URL` auto-discovered from SST resource linking
- Auth hooks are extensible without the framework knowing about JWT strategies
- CORS handling built-in
- Consistent header forwarding behavior

---

## 2. Migration Tooling

**Problem:** When entity schemas evolve — fields renamed, enum values changed, tags updated — there's no built-in way to migrate existing DynamoDB data. Developers must write ad-hoc scripts.

**Proposal:** Built-in migration helpers for common schema evolution tasks:

### Tag Reprocessing

When a tag processor changes, reprocess all entities to update their tag entries:

```bash
monorise migrate:tags --entity member --tag yearQuarter
```

Or programmatic:

```typescript
import { reprocessTags } from 'monorise/core';

await reprocessTags({
  entityType: 'member',
  tagName: 'yearQuarter',
  // Optional: filter which entities to reprocess
  filter: (entity) => entity.data.status === 'active',
});
```

### Field Backfill

When a new field is added with a default value:

```typescript
import { backfillField } from 'monorise/core';

await backfillField({
  entityType: 'member',
  field: 'gamesPlayed',
  defaultValue: 0,
  // Optional: compute from existing data
  compute: (entity) => entity.data.matchHistory?.length || 0,
});
```

### Search Reindex

When searchableFields changes:

```bash
monorise migrate:search --entity member
```

### Design Principles
- Git/blame remains the source of truth for schema history — entity configs ARE the schema
- No migration files or migration database — migrations are imperative operations
- Idempotent — safe to re-run
- Progress tracking with resume capability for large datasets

---

## 3. Auto-Generated `.http` Test Files

**Problem:** Testing entity APIs requires manually constructing HTTP requests. Since monorise already knows every entity's schema, it can generate these automatically.

**Proposal:** During `monorise dev` and `monorise build`, auto-generate `.monorise/http/` files:

```http
### ─── Member ───

### List members
GET {{BASE_URL}}/core/entity/member?limit=10
x-api-key: {{X_API_KEY}}

### Search members
GET {{BASE_URL}}/core/entity/member?query=john
x-api-key: {{X_API_KEY}}

### Create member (minimum required fields)
POST {{BASE_URL}}/core/entity/member
x-api-key: {{X_API_KEY}}
Content-Type: application/json

{
  "name": "Example Name",
  "dob": "1990-01-15T00:00:00.000Z",
  "gender": "male"
}

### Get member by ID
GET {{BASE_URL}}/core/entity/member/{{memberId}}
x-api-key: {{X_API_KEY}}

### Update member (partial)
PATCH {{BASE_URL}}/core/entity/member/{{memberId}}
x-api-key: {{X_API_KEY}}
Content-Type: application/json

{
  "gamesPlayed": 10,
  "wins": 7
}

### Delete member
DELETE {{BASE_URL}}/core/entity/member/{{memberId}}
x-api-key: {{X_API_KEY}}
```

**Example value generation from Zod schema:**
- `z.string()` → field name as placeholder (e.g., `"Example Name"`)
- `z.string().email()` → `"example@email.com"`
- `z.string().datetime()` → `"1990-01-15T00:00:00.000Z"`
- `z.number()` → `0`
- `z.enum(['a', 'b'])` → first value `"a"`
- `z.boolean()` → `true`

Also generate tag and mutual endpoints when configured:

```http
### List members by tag 'status', group 'active'
GET {{BASE_URL}}/core/tag/member/status?group=active
x-api-key: {{X_API_KEY}}

### List members related to organisation
GET {{BASE_URL}}/core/mutual/organisation/{{organisationId}}/member
x-api-key: {{X_API_KEY}}
```

**Environment file** (`.monorise/http/env.json`):
```json
{
  "local": {
    "BASE_URL": "http://localhost:3000/api",
    "X_API_KEY": "secret1"
  }
}
```

Works with VS Code REST Client, JetBrains HTTP Client, and similar tools. SST's remocal experience means these hit real infrastructure locally.

---

## 4. Server Component Support (`monorise/react/server`)

**Problem:** Monorise's React layer is entirely client-side (`'use client'`). As Next.js pushes toward React Server Components, list pages and detail views could benefit from server-side rendering without shipping JavaScript for data fetching.

**Proposal:** A `monorise/react/server` export with RSC-compatible async functions:

```typescript
// Server-side data fetching (no client JS shipped)
import { fetchEntities, fetchEntity, fetchTaggedEntities } from 'monorise/react/server';

// In a server component
export default async function MembersPage() {
  const { data: members } = await fetchEntities(Entity.MEMBER, {
    limit: 20,
  });

  return (
    <div>
      {members.map((member) => (
        <MemberRow key={member.entityId} member={member} />
      ))}
    </div>
  );
}
```

**Key considerations:**
- Server functions call the API directly (no proxy hop needed)
- No zustand stores — returns raw data
- Client components still use `useEntities` etc. for interactive features (forms, search, optimistic updates)
- Hydration bridge: pass server-fetched data to client stores to avoid double-fetching

```typescript
// Hydration pattern
import { HydrateEntities } from 'monorise/react';

export default async function MembersPage() {
  const { data: members } = await fetchEntities(Entity.MEMBER);

  return (
    <>
      {/* Hydrate client store with server-fetched data */}
      <HydrateEntities entityType={Entity.MEMBER} data={members} />
      {/* Client component can now use useEntities without refetching */}
      <MembersListClient />
    </>
  );
}
```

---

## 5. Module Augmentation Cleanup

**Problem:** The generated `.monorise/config.ts` includes `declare module '@monorise/base'` which references the old `@monorise/base` import path. Since imports have moved to `monorise/base`, this creates confusion and could cause type resolution issues.

**Proposal:** Update the code generator to use the current import path:

```typescript
// Before (generated)
declare module '@monorise/base' {
  export enum Entity { ... }
  export interface EntitySchemaMap { ... }
}

// After (generated)
declare module 'monorise/base' {
  export enum Entity { ... }
  export interface EntitySchemaMap { ... }
}
```

This is a small change but prevents confusion for new developers reading the generated code.

---

## 6. Entity Lifecycle Hooks

**Problem:** Custom business logic often needs to run before or after entity operations (e.g., send a notification after creation, validate against external services before update). Currently this requires custom routes that duplicate CRUD logic.

**Proposal:** Lifecycle hooks in entity config:

```typescript
const config = createEntityConfig({
  name: 'order',
  baseSchema,
  createSchema,
  hooks: {
    beforeCreate: async (draft, context) => {
      // Validate, transform, or reject
      return { ...draft, createdBy: context.accountId };
    },
    afterCreate: async (entity, context) => {
      // Side effects: notifications, analytics
      await notifySlack(`New order: ${entity.data.description}`);
    },
    beforeUpdate: async (id, patch, context) => {
      // Prevent certain updates
      if (patch.status === 'paid' && !patch.paidAt) {
        throw new Error('paidAt required when marking as paid');
      }
      return patch;
    },
    afterDelete: async (entityId, context) => {
      // Cleanup related resources
    },
  },
});
```

This keeps business logic co-located with entity definitions without requiring separate route handlers for simple cases.

---

## 7. Admin/Debug Dashboard

**Problem:** During development, understanding what's in DynamoDB requires either AWS Console or custom scripts. A built-in dashboard would speed up development.

**Proposal:** A dev-only dashboard page that monorise auto-generates:

- Lists all entity types with counts
- Browse/search entities per type
- View tag indices
- View mutual relationships
- Raw DynamoDB record view for debugging

Could be a standalone route (`/core/admin/*`) protected behind a dev-only flag, or a separate Next.js page.

---

## 8. Batch Operations

**Problem:** No built-in support for bulk create/update/delete. Common in admin tools, data imports, and migrations.

**Proposal:**

```typescript
// Backend
import { batchCreateEntities, batchDeleteEntities } from 'monorise/core';

await batchCreateEntities(Entity.MEMBER, [
  { name: 'Alice', dob: '...', gender: 'female' },
  { name: 'Bob', dob: '...', gender: 'male' },
]);

// Frontend
import { batchCreate, batchDelete } from 'monorise/react';

const { data, errors } = await batchCreate(Entity.MEMBER, members);
```

Must handle DynamoDB's 25-item batch write limit internally, with progress callbacks for large batches.

---

## 9. Typed Custom Routes

**Problem:** Custom routes (`customRoutes` in monorise.config.ts) don't benefit from entity type safety. The DependencyContainer gives you repositories, but request/response types are untyped.

**Proposal:** Route helpers with type inference from entity configs:

```typescript
import { typedRoute } from 'monorise/core';

app.post('/custom-action', typedRoute({
  body: orderConfig.createSchema.extend({
    memberId: z.string(),
  }),
  response: orderConfig.finalSchema,
  handler: async (body, c) => {
    // body is fully typed from the schema
    const order = await container.entityService.createEntity({
      entityType: Entity.ORDER,
      entityPayload: body,
      accountId: c.req.header('account-id'),
    });
    return order;
  },
}));
```

---

## 10. Field-Level Selection (Projection)

**Problem:** Monorise always returns the full entity on every read. For entities with many fields or large text/array fields, this wastes DynamoDB read capacity units and network bandwidth — especially on list pages where only a few columns are displayed. GraphQL solves this with field selection; monorise should too.

**Proposal:** A `fields` query parameter on all read endpoints. When omitted, all fields are returned (current behavior). When specified, only the requested fields are projected.

Backend:

```
GET /core/entity/member?fields=name,gender,gamesPlayed
GET /core/entity/member/123?fields=name,dob
GET /core/tag/order/status?group=pending&fields=amount,description
GET /core/mutual/organisation/org-123/member?fields=name
```

This maps directly to DynamoDB's `ProjectionExpression`, which reduces both read capacity consumption and response payload size.

Frontend hooks:

```typescript
// List page only needs display columns
const { entities } = useEntities(Entity.MEMBER, {
  fields: ['name', 'gender', 'gamesPlayed', 'wins'],
});

// Detail view needs everything — omit fields param
const { entity } = useEntity(Entity.MEMBER, memberId);

// Tagged entities with projection
const { entities } = useTaggedEntities(Entity.ORDER, 'status', {
  params: { group: 'pending' },
  fields: ['amount', 'description', 'status'],
});
```

**Type safety:** The `fields` param could narrow the return type so `entity.data` only contains the requested fields:

```typescript
// entity.data is Pick<MemberType, 'name' | 'gender'>
const { entities } = useEntities(Entity.MEMBER, {
  fields: ['name', 'gender'] as const,
});
```

**Cost impact:** A member entity with 20 fields read 10,000 times per day — projecting down to 5 fields could cut DynamoDB read costs significantly, especially for list pages that only show a summary.

**Caching consideration:** The local zustand cache would need to handle partial entities. A projected entity should not overwrite a previously cached full entity. Merge strategy: partial reads fill missing fields but never erase existing cached fields.

---

## 11. Real-Time Subscriptions

**Problem:** The current architecture is request-response only. No way to push updates to the frontend when entities change.

**Proposal:** WebSocket or SSE support for entity change subscriptions:

```typescript
// Frontend
import { useEntitySubscription } from 'monorise/react';

const { entity } = useEntitySubscription(Entity.ORDER, orderId);
// Automatically updates when the order changes on the backend
```

This would leverage the existing EventBridge bus — a Lambda subscribes to entity events and pushes to connected WebSocket clients via API Gateway WebSocket.

---

## 12. Multi-Framework Support (Vue, Svelte, Solid, etc.)

**Problem:** Monorise's frontend layer (`monorise/react`) is tightly coupled to React and Zustand. Teams using Vue, Svelte, Solid, or other frameworks cannot use monorise's client-side state management, hooks, or optimistic updates.

**Proposal:** Extract a framework-agnostic core and provide framework-specific adapters:

```
monorise/store    — Framework-agnostic state management (vanilla Zustand/store)
monorise/react    — React hooks (useEntities, useMutuals, etc.)
monorise/vue      — Vue composables (useEntities, useMutuals, etc.)
monorise/svelte   — Svelte stores ($entities, $mutuals, etc.)
monorise/solid    — Solid signals (createEntities, createMutuals, etc.)
```

**Approach:**
1. Extract all API calls, store logic, and optimistic update logic into a framework-agnostic layer (`monorise/store`)
2. Each framework adapter is a thin wrapper that subscribes to the store using the framework's reactivity primitives
3. The backend, entity configs, and CLI remain unchanged — only the frontend layer varies

**Benefits:**
- Monorise becomes viable for any frontend stack
- Shared store logic means bug fixes and features apply to all frameworks
- Each adapter is small (~200-300 lines) since the heavy lifting is in the core store

---

## Priority Assessment

| Enhancement | Impact | Effort | Priority |
|-------------|--------|--------|----------|
| Config-based API proxy | High | Low | P1 |
| Migration tooling (tag reprocessing) | High | Medium | P1 |
| Auto-generated .http files | Medium | Low | P1 |
| Module augmentation cleanup | Low | Low | P1 |
| Field-level selection (projection) | High | Medium | P2 |
| Server component support | High | High | P2 |
| Entity lifecycle hooks | High | Medium | P2 |
| Typed custom routes | Medium | Medium | P2 |
| Batch operations | Medium | Medium | P3 |
| Admin/debug dashboard | Medium | High | P3 |
| Real-time subscriptions | High | High | P3 |
| Multi-framework support | High | High | P3 |
