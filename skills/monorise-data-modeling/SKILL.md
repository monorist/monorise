---
name: monorise-data-modeling
description: Expert in data modeling with Monorise single-table patterns. Use when designing entity schemas, mutual relationships, and tag-based access patterns. Focuses on O(1) access optimization through proper mutual design, strategic denormalization, and access pattern-first design. Covers entities vs mutuals vs tags, with prejoins as last resort for complex multi-hop queries, and migration strategies for schema changes.
---

# Monorise Data Modeling

Guide for designing data models using Monorise's access pattern-first approach.

## Core Principle: Design by Access Pattern

**Always start with how data will be queried, not how it's normalized.** Monorise optimizes for read performance through strategic denormalization.

### The Access Pattern Priority

1. **Direct Entity Lookup** - `PK = entityType#entityId` - O(1)
2. **Mutual Relationship** - Bidirectional link with metadata - O(1)
3. **Tag Query** - Filtered/sorted subsets - O(1)
4. **Prejoin** - Multi-hop relationship shortcut (LAST RESORT) - O(1) read, expensive write

## Entities: The Foundation

Define entities around business objects that are queried independently.

```typescript
// entities/organization.ts
const config = createEntityConfig({
  name: 'organization',
  displayName: 'Organization',
  baseSchema: z.object({
    name: z.string(),
    slug: z.string(),
    status: z.enum(['active', 'suspended', 'deleted']),
    tier: z.enum(['free', 'pro', 'enterprise']),
    region: z.string(),
    createdAt: z.string(),
  }).partial(),
  uniqueFields: ['slug'],  // Enforce unique constraints
});
```

### Entity Design Rules

**DO:**
- Include fields frequently displayed in lists
- Add `uniqueFields` for natural identifiers (email, slug, externalId)
- Keep entity count manageable (use tags/mutuals for high-cardinality relationships)

**DON'T:**
- Store arrays of related IDs (use mutuals instead)
- Add computed fields (compute on read or use prejoins)
- Create entities for join tables (use mutuals)

## Mutuals: The Primary Relationship Pattern

**The golden rule:** If you need to query "all X for Y" bidirectionally, use a mutual.

### Pattern 1: Direct Relationship (Skip RDS Joins)

**Traditional RDS approach (3 hops):**
```sql
-- Slow: Join 3 tables
SELECT t.* FROM transaction t
JOIN user u ON t.userId = u.id
JOIN organization o ON u.orgId = o.id
WHERE o.id = 'org-123';
```

**Monorise approach (direct mutual):**
```typescript
// Transaction entity with DIRECT mutual to org
const transactionConfig = createEntityConfig({
  name: 'transaction',
  displayName: 'Transaction',
  baseSchema: z.object({
    amount: z.number(),
    currency: z.string(),
    status: z.enum(['pending', 'completed', 'failed']),
    // Store orgId for reference, but relationship is via mutual
    orgId: z.string(),
    userId: z.string(),
  }),
  mutual: {
    mutualSchema: z.object({
      // Relationship metadata
      role: z.enum(['payer', 'receiver']).optional(),
      transactionType: z.enum(['sale', 'refund', 'transfer']).optional(),
    }),
    mutualFields: {
      // Direct O(1) link to org - NO intermediate user hop needed!
      orgId: { entityType: 'organization' },
      userId: { entityType: 'user' },
    },
  },
});
```

**Query:**
```typescript
// O(1) - Direct mutual lookup
const { mutuals } = useMutuals('organization', 'transaction', orgId);
// Returns all transactions with their data AND mutual metadata
```

**Key insight:** You don't need prejoins for this! A simple mutual gives you direct O(1) access from organization to all its transactions. The denormalization is handled automatically by Monorise's mutual processor.

### Pattern 2: Rich Relationship Data

When the relationship itself has meaningful data:

```typescript
// Enrollment mutual between student and course
const enrollmentConfig = createEntityConfig({
  name: 'enrollment',
  displayName: 'Enrollment',
  baseSchema: z.object({
    enrolledAt: z.string(),
  }),
  mutual: {
    mutualSchema: z.object({
      status: z.enum(['active', 'completed', 'dropped']),
      progress: z.number().min(0).max(100),
      grade: z.string().optional(),
      completedAt: z.string().optional(),
      lastAccessedAt: z.string(),
    }),
    mutualFields: {
      studentId: { entityType: 'student' },
      courseId: { entityType: 'course' },
    },
  },
});

// Query all courses for a student with enrollment data
const { mutuals } = useMutuals('student', 'course', studentId);
// mutual.mutualData.grade, mutual.mutualData.progress
// mutual.data (the course entity)
```

### Pattern 3: Self-Referential Relationships

Hierarchical data using mutuals:

```typescript
const categoryConfig = createEntityConfig({
  name: 'category',
  displayName: 'Category',
  baseSchema: z.object({
    name: z.string(),
    slug: z.string(),
  }),
  mutual: {
    mutualSchema: z.object({
      order: z.number(),  // For sorting subcategories
    }),
    mutualFields: {
      parentId: { entityType: 'category' },  // Self-reference
    },
  },
});

// Get all subcategories
const { mutuals: subcategories } = useMutuals('category', 'category', parentId);
```

### Pattern 4: Multi-Entity Relationships

An entity can have mutuals to multiple other entities:

```typescript
const documentConfig = createEntityConfig({
  name: 'document',
  displayName: 'Document',
  baseSchema: z.object({
    title: z.string(),
    content: z.string(),
    fileUrl: z.string().optional(),
  }),
  mutual: {
    mutualSchema: z.object({
      accessLevel: z.enum(['owner', 'editor', 'viewer']),
      sharedAt: z.string(),
    }),
    mutualFields: {
      // Document belongs to organization
      orgId: { entityType: 'organization' },
      // Document created by user
      createdById: { entityType: 'user' },
      // Document in project (optional)
      projectId: { entityType: 'project' },
      // Document in folder (optional)
      folderId: { entityType: 'folder' },
    },
  },
});

// Query all documents in an organization
const { mutuals: orgDocs } = useMutuals('organization', 'document', orgId);

// Query all documents in a project
const { mutuals: projectDocs } = useMutuals('project', 'document', projectId);

// Query all documents created by a user
const { mutuals: userDocs } = useMutuals('user', 'document', userId);
```

## Tags: Advanced Access Patterns

Use tags when you need:
- Filtered subsets (status, region, type)
- Range queries (date ranges, numeric ranges)
- Sorted listings without full scan

### Pattern 1: Status-Based Access

```typescript
const userConfig = createEntityConfig({
  name: 'user',
  displayName: 'User',
  baseSchema: z.object({
    email: z.string(),
    name: z.string(),
    status: z.enum(['active', 'inactive', 'pending']),
    role: z.enum(['admin', 'member', 'viewer']),
  }),
  tags: [
    {
      name: 'status',
      processor: (entity) => [{
        group: entity.data.status,  // status#active, status#inactive
      }],
    },
    {
      name: 'role',
      processor: (entity) => [{
        group: entity.data.role,    // role#admin, role#member
      }],
    },
  ],
});

// Query all active users - O(1)
const { entities: activeUsers } = useTaggedEntities('user', 'status', {
  params: { group: 'active' }
});
```

### Pattern 2: Temporal Access Patterns

```typescript
const transactionConfig = createEntityConfig({
  name: 'transaction',
  displayName: 'Transaction',
  baseSchema: z.object({
    amount: z.number(),
    createdAt: z.string(),
  }),
  tags: [
    {
      name: 'createdAt',
      processor: (entity) => [{
        sortValue: entity.data.createdAt,  // For date range queries
      }],
    },
    {
      name: 'monthly',
      processor: (entity) => {
        const date = new Date(entity.data.createdAt);
        return [{
          group: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
          sortValue: entity.data.createdAt,
        }];
      },
    },
  ],
});

// Query transactions for January 2024
const { entities: janTransactions } = useTaggedEntities('transaction', 'monthly', {
  params: { group: '2024-01' }
});

// Query transactions from date range
const { entities: recentTxns } = useTaggedEntities('transaction', 'createdAt', {
  params: {
    start: '2024-01-01',
    end: '2024-01-31'
  }
});
```

### Pattern 3: Composite Tags

Multiple dimensions of tagging:

```typescript
const orderConfig = createEntityConfig({
  name: 'order',
  displayName: 'Order',
  baseSchema: z.object({
    customerId: z.string(),
    status: z.enum(['pending', 'processing', 'shipped', 'delivered']),
    priority: z.enum(['low', 'medium', 'high', 'urgent']),
    region: z.string(),
    totalAmount: z.number(),
    createdAt: z.string(),
  }),
  tags: [
    // By status for workflow views
    {
      name: 'status',
      processor: (entity) => [{
        group: entity.data.status,
        sortValue: entity.data.createdAt,
      }],
    },
    // By priority for triage
    {
      name: 'priority',
      processor: (entity) => [{
        group: entity.data.priority,
        sortValue: entity.createdAt,
      }),
    },
    // By region for fulfillment
    {
      name: 'region',
      processor: (entity) => [{
        group: entity.data.region,
        sortValue: entity.data.createdAt,
      }],
    },
    // High-value orders (amount > 1000)
    {
      name: 'high-value',
      processor: (entity) => {
        if (entity.data.totalAmount > 1000) {
          return [{ sortValue: String(entity.data.totalAmount).padStart(10, '0') }];
        }
        return [];
      },
    },
  ],
});

// Use cases:
// - All pending orders: useTaggedEntities('order', 'status', { params: { group: 'pending' } })
// - Urgent orders: useTaggedEntities('order', 'priority', { params: { group: 'urgent' } })
// - EU region orders: useTaggedEntities('order', 'region', { params: { group: 'eu-west' } })
// - High-value orders sorted by amount: useTaggedEntities('order', 'high-value')
```

## Prejoins: LAST RESORT for Multi-Hop Queries

**⚠️ WARNING:** Prejoins create expensive write operations. Only use when you have a clear multi-hop access pattern that cannot be solved with mutuals.

### When NOT to Use Prejoins

**DON'T use prejoins for:**
- Direct entity-to-entity relationships (use mutuals)
- Simple parent-child relationships (use mutuals)
- Anything that can be solved with a single mutual lookup

**Example of WRONG prejoin usage:**
```typescript
// ❌ WRONG: Prejoin not needed here
const transactionConfig = createEntityConfig({
  name: 'transaction',
  mutual: {
    mutualFields: {
      orgId: { entityType: 'organization' },
    },
    // ❌ Don't do this - just use mutual directly!
    prejoins: [...]
  },
});

// Just use: useMutuals('organization', 'transaction', orgId)
```

### When to Use Prejoins

**ONLY use prejoins for:**
- Multi-hop traversals (3+ entities) that are queried frequently
- When intermediate entities don't need to be accessed
- Read-heavy, write-rare scenarios

**Example of CORRECT prejoin usage:**
```typescript
// Student -> Enrollment -> Course -> Module
// Need to find all modules a student can access (skipping courses)

const studentConfig = createEntityConfig({
  name: 'student',
  displayName: 'Student',
  baseSchema: z.object({
    name: z.string(),
    email: z.string(),
  }),
  mutual: {
    mutualSchema: z.object({}),
    mutualFields: {
      // Student enrolled in courses
      courseId: { entityType: 'course' },
    },
    // Prejoin: student -> course -> module (skipping course lookup)
    prejoins: [
      {
        mutualField: 'courseId',
        targetEntityType: 'module',
        entityPaths: [
          { entityType: 'course' },  // course has modules
        ],
      },
    ],
  },
});

const courseConfig = createEntityConfig({
  name: 'course',
  displayName: 'Course',
  baseSchema: z.object({
    title: z.string(),
  }),
  mutual: {
    mutualSchema: z.object({
      order: z.number(),
    }),
    mutualFields: {
      moduleId: { entityType: 'module' },
    },
  },
});
```

**Without prejoin:**
1. Fetch student's courses: `useMutuals('student', 'course', studentId)`
2. For each course, fetch modules: `useMutuals('course', 'module', courseId)`
3. Combine results client-side

**With prejoin:**
1. Direct fetch: `useMutuals('student', 'module', studentId)`

**Trade-off:** Writes become expensive (updates cascade through prejoin chain), but reads are O(1).

## Access Pattern Decision Tree

```
Need to store data about a business object?
│
├── Yes → Create an Entity
│   └── Need to query by unique field (email, slug)?
│       ├── Yes → Add to uniqueFields
│       └── No → Standard entity
│
└── Need to link two entities?
    │
    ├── Direct relationship needed?
    │   ├── Yes → Create a Mutual
    │   │   └── Need relationship metadata (role, date, status)?
    │   │       ├── Yes → Add to mutualSchema
    │   │       └── No → Empty mutualSchema is fine
    │   │
    │   └── Need filtered/sorted subsets?
    │       ├── Yes → Add Tags
    │       │   ├── Temporal (date ranges) → Tag with sortValue
    │       │   ├── Categorical (status, type) → Tag with group
    │       │   └── Complex filter → Tag with group + sortValue
    │       └── No → Entity/mutual list is fine
    │
    └── Multi-hop (3+ entities) queried frequently?
        └── Yes → Consider Prejoin (LAST RESORT)
            └── Writes are rare and reads are frequent?
                ├── Yes → Use prejoin
                └── No → Handle multi-hop in application layer
```

## Schema Evolution & Migrations

When adding new tags or mutuals to existing entities, **migration is required** to populate the new access patterns for existing data.

### Migration Script Pattern

```typescript
// migrations/2024-01-add-org-transaction-mutual.ts
import { Monorise } from '@monorise/core';

export const migrate = async () => {
  const mr = new Monorise();

  // 1. Get all existing transactions
  const transactions = await mr.listAll('transaction');

  // 2. For each transaction, create the new mutual
  for (const txn of transactions) {
    // Create direct org-transaction mutual
    await mr.createMutual(
      'organization',
      'transaction',
      txn.data.orgId,      // Already stored on transaction
      txn.entityId,
      {
        transactionType: 'sale',  // Default for existing
      }
    );

    console.log(`Migrated transaction ${txn.entityId} for org ${txn.data.orgId}`);
  }

  console.log(`Migration complete: ${transactions.length} transactions processed`);
};
```

### Running Migrations

```bash
# Execute migration
npx ts-node migrations/2024-01-add-org-transaction-mutual.ts

# Or integrate with your deployment pipeline
npm run migrate
```

**Don't avoid migrations** - they are:
- **Fast:** Single-table queries are O(1) per item
- **Safe:** Can run incrementally with pagination
- **Essential:** Without them, existing data won't appear in new tags/mutuals
- **Easy:** Monorise migrations are straightforward

## Common Modeling Scenarios

### Scenario 1: User-Organization Membership

**Wrong:** Store orgId on user entity
```typescript
// ❌ Anti-pattern
const userConfig = createEntityConfig({
  name: 'user',
  baseSchema: z.object({
    orgId: z.string(),  // Single org assumption
    // What about multiple orgs?
    // What about membership metadata (role, joinedAt)?
  }),
});
```

**Right:** Mutual relationship
```typescript
const membershipConfig = createEntityConfig({
  name: 'membership',
  displayName: 'Membership',
  baseSchema: z.object({
    joinedAt: z.string(),
  }),
  mutual: {
    mutualSchema: z.object({
      role: z.enum(['owner', 'admin', 'member']),
      status: z.enum(['active', 'invited', 'suspended']),
    }),
    mutualFields: {
      orgId: { entityType: 'organization' },
      userId: { entityType: 'user' },
    },
  },
});

// Query user's orgs
useMutuals('user', 'membership', userId);

// Query org's members
useMutuals('organization', 'membership', orgId);
```

### Scenario 2: E-Commerce Order System

```typescript
// Order entity with multiple access patterns
const orderConfig = createEntityConfig({
  name: 'order',
  displayName: 'Order',
  baseSchema: z.object({
    orderNumber: z.string(),
    totalAmount: z.number(),
    currency: z.string(),
    shippingAddress: z.object({...}),
    createdAt: z.string(),
    // Denormalized for convenience
    customerId: z.string(),
    orgId: z.string(),
  }),
  uniqueFields: ['orderNumber'],
  mutual: {
    mutualSchema: z.object({
      // Customer relationship metadata
      customerType: z.enum(['guest', 'registered']),
    }),
    mutualFields: {
      customerId: { entityType: 'customer' },
      orgId: { entityType: 'organization' },
    },
  },
  tags: [
    // Status workflow
    {
      name: 'status',
      processor: (e) => [{
        group: e.data.status,
        sortValue: e.data.createdAt,
      }],
    },
    // Date-based queries
    {
      name: 'createdAt',
      processor: (e) => [{
        sortValue: e.data.createdAt,
      }],
    },
    // Fulfillment region
    {
      name: 'region',
      processor: (e) => [{
        group: e.data.shippingAddress.region,
        sortValue: e.data.createdAt,
      }],
    },
  ],
});

// Line items as separate entity with mutual to order
const lineItemConfig = createEntityConfig({
  name: 'line-item',
  displayName: 'Line Item',
  baseSchema: z.object({
    quantity: z.number(),
    unitPrice: z.number(),
    productName: z.string(),  // Denormalized for display
  }),
  mutual: {
    mutualSchema: z.object({}),
    mutualFields: {
      orderId: { entityType: 'order' },
      productId: { entityType: 'product' },
    },
  },
});
```

### Scenario 3: Activity Feed

```typescript
const activityConfig = createEntityConfig({
  name: 'activity',
  displayName: 'Activity',
  baseSchema: z.object({
    action: z.enum(['created', 'updated', 'deleted', 'commented']),
    entityType: z.string(),
    entityId: z.string(),
    metadata: z.record(z.any()),
    createdAt: z.string(),
  }),
  tags: [
    // Global feed - sorted by time
    {
      name: 'global-feed',
      processor: (e) => [{
        sortValue: e.createdAt,
      }],
    },
    // Per-entity activity
    {
      name: 'entity-activity',
      processor: (e) => [{
        group: `${e.data.entityType}#${e.data.entityId}`,
        sortValue: e.createdAt,
      }],
    },
    // Per-actor activity
    {
      name: 'actor-activity',
      processor: (e) => [{
        group: e.data.actorId,
        sortValue: e.createdAt,
      }],
    },
  ],
});

// Get global feed
useTaggedEntities('activity', 'global-feed', {
  params: { limit: 50 }
});

// Get activity for specific entity
useTaggedEntities('activity', 'entity-activity', {
  params: { group: 'project#proj-123' }
});
```

## Anti-Patterns

### ❌ Array of IDs in Entity

```typescript
// WRONG
const projectConfig = createEntityConfig({
  name: 'project',
  baseSchema: z.object({
    memberIds: z.array(z.string()),  // ❌ Don't do this
  }),
});
```

**Problems:**
- Can't query "all projects for user" efficiently
- No place for membership metadata (role, addedAt)
- Array updates are not atomic

### ❌ Using Prejoin for Direct Relationships

```typescript
// WRONG
const transactionConfig = createEntityConfig({
  name: 'transaction',
  mutual: {
    mutualFields: {
      orgId: { entityType: 'organization' },
    },
    // ❌ WRONG: Don't use prejoin for direct relationship!
    prejoins: [{
      mutualField: 'orgId',
      targetEntityType: 'organization',
      entityPaths: [...],
    }],
  },
});

// Just use: useMutuals('organization', 'transaction', orgId)
```

### ❌ Over-Tagging

```typescript
// WRONG
const userConfig = createEntityConfig({
  name: 'user',
  tags: [
    { name: 'email', processor: ... },      // ❌ Use uniqueField
    { name: 'name', processor: ... },       // ❌ Not useful for filtering
    { name: 'bio', processor: ... },        // ❌ High cardinality, no value
  ],
});
```

### ❌ Tag as Primary Relationship

```typescript
// WRONG
const orderConfig = createEntityConfig({
  name: 'order',
  tags: [
    {
      name: 'customer-orders',
      processor: (e) => [{
        group: e.data.customerId,  // ❌ Use mutual instead
      }],
    },
  ],
});
```

Use mutuals for relationships, tags for filtered subsets.

## Performance Guidelines

### Tag Cardinality

| Tag Type | Cardinality | Use Case |
|----------|-------------|----------|
| Status | Low (3-10) | Always use tag |
| Type/Category | Low-Medium (10-100) | Use tag |
| Region | Low (5-20) | Use tag |
| Date | High (unbounded) | Use sortValue, range queries |
| User-generated | Very High | Don't tag, use entity |

### Mutual Limits

- **Practical limit:** ~10,000 mutuals per entity side
- If expecting more, consider:
  - Time-based sharding (mutual with temporal tag)
  - Summary entities (roll up to daily/weekly summaries)

### Prejoin Costs

| Operation | Cost |
|-----------|------|
| Read | O(1) - Fast |
| Write | O(n) - Expensive (cascades through chain) |
| Storage | Higher (denormalized copies) |

**Only use prejoins when:**
- Read operations are 10x+ more frequent than writes
- Multi-hop query is causing performance issues
- You have profiled and confirmed the bottleneck

## Review Checklist

When reviewing a data model:

- [ ] All access patterns supported by entity/mutual/tag
- [ ] No arrays of IDs in entity schemas
- [ ] Relationships use mutuals (not tags or arrays)
- [ ] Prejoins only used for 3+ hop relationships
- [ ] Tags used for filtering/sorting, not relationships
- [ ] Migration plan for new tags/mutuals on existing entities
- [ ] uniqueFields defined for natural identifiers
- [ ] Tag cardinality considered (avoid ultra-high cardinality tags)
- [ ] Prejoin write costs justified by read patterns
