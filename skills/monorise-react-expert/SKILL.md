---
name: monorise-react-expert
description: Expert in implementing React applications using Monorise patterns. Use when building or modifying React components that interact with Monorise backend APIs, managing entity data, mutual relationships, or tags. Covers useEntity, useEntities, useMutual, useMutuals, useTaggedEntities hooks and related patterns. Prioritize Monorise concepts over custom useEffect/useState for data fetching.
---

# Monorise React Expert

Guide for implementing React frontends using Monorise patterns and hooks.

## Core Principles

**ALWAYS prioritize Monorise hooks over custom useEffect/useState for data operations.** Monorise hooks provide caching, automatic state synchronization, and optimistic updates out of the box.

### The Monorise Mental Model

Monorise uses three core building blocks:

1. **Entity** - A first-class record (e.g., `user`, `course`, `organization`)
2. **Mutual** - A relationship between two entities that can hold data (e.g., `enrollment` linking `student` ↔ `course` with `grade`, `enrolledAt`)
3. **Tag** - A key-value access pattern for fast querying (e.g., `status#active`, `region#eu-west`)

## Component Design: Avoid Props Drilling with Hooks

**Key principle:** Passing entity/mutual data through props to child components is often an anti-pattern. **Use Monorise hooks in child components instead.**

### Why Hooks Over Props?

1. **Local Cache First** - Hooks check Zustand store before API calls. Same entity ID = instant retrieval, no network request.
2. **Optimistic Updates** - Create/update/delete operations update local cache immediately. All subscribed components re-render with new data without waiting for backend.
3. **Backend Async** - Denormalization happens asynchronously on the backend. Local cache updates synchronously.
4. **No Props Drilling** - Cleaner component trees, less prop threading.

### ❌ Anti-Pattern: Props Drilling

```typescript
// Parent fetches and passes down
const OrganizationPage = ({ orgId }: { orgId: string }) => {
  const { entity: org } = useEntity('organization', orgId);
  const { mutuals: members } = useMutuals('organization', 'membership', orgId);

  return (
    <div>
      <OrgHeader org={org} />           {/* Passing entity via props */}
      <MemberList members={members} />   {/* Passing mutuals via props */}
    </div>
  );
};

// Child receives props
const OrgHeader = ({ org }: { org: CreatedEntity<'organization'> }) => {
  return <h1>{org.data.name}</h1>;  // Stale if org updates elsewhere
};

// Child receives props - problem: no reactivity to membership changes
const MemberList = ({ members }: { members: Mutual[] }) => {
  return members.map(m => <MemberCard key={m.entityId} member={m} />);
};
```

**Problems:**
- Org updates in other components won't refresh OrgHeader
- MemberList won't auto-update when new members added
- Props threading through multiple layers becomes messy

### ✅ Preferred: Use Hooks in Child Components

```typescript
// Parent is simple, just passes IDs
const OrganizationPage = ({ orgId }: { orgId: string }) => {
  return (
    <div>
      <OrgHeader orgId={orgId} />
      <MemberList orgId={orgId} />
    </div>
  );
};

// Child fetches its own data from cache
const OrgHeader = ({ orgId }: { orgId: string }) => {
  const { entity: org } = useEntity('organization', orgId);
  // Automatically re-renders when org updates anywhere in app
  return <h1>{org?.data.name}</h1>;
};

// Child manages its own subscription
const MemberList = ({ orgId }: { orgId: string }) => {
  const { mutuals, isLoading } = useMutuals('organization', 'membership', orgId);
  // Automatically re-renders when members change
  return (
    <>
      {mutuals.map(m => (
        <MemberCard key={m.entityId} userId={m.entityId} />
      ))}
    </>
  );
};

// Even deeper component gets its own data
const MemberCard = ({ userId }: { userId: string }) => {
  const { entity: user } = useEntity('user', userId);
  // Fetches from cache instantly, no API call if already loaded
  return <div>{user?.data.name}</div>;
};
```

**Benefits:**
- Each component subscribes to its own data
- Automatic re-rendering on any update
- No props threading
- Cache-first = high performance

### Cache Behavior Explained

```typescript
// Component A renders first
const ComponentA = ({ userId }: { userId: string }) => {
  const { entity: user } = useEntity('user', userId);
  // Makes API call: GET /api/core/entity/user/user-123
  // Stores in Zustand cache
  return <div>{user?.data.name}</div>;
};

// Component B renders 1 second later
const ComponentB = ({ userId }: { userId: string }) => {
  const { entity: user } = useEntity('user', userId);
  // Same userId = retrieves from cache instantly, NO API call
  return <div>{user?.data.email}</div>;
};
```

### Optimistic Updates in Action

```typescript
const MemberList = ({ orgId }: { orgId: string }) => {
  const { mutuals } = useMutuals('organization', 'membership', orgId);

  const handleInvite = async (userId: string) => {
    // 1. API call starts
    const { data } = await createMutual('organization', 'membership', orgId, userId, {
      role: 'member',
      invitedAt: new Date().toISOString(),
    });

    // 2. Local cache updates IMMEDIATELY (optimistic)
    // 3. MemberList re-renders with new member instantly
    // 4. Backend processes denormalization asynchronously
  };

  return (
    <>
      {mutuals.map(m => <MemberCard key={m.entityId} userId={m.entityId} />)}
      <InviteButton onInvite={handleInvite} />
    </>
  );
};
```

### ⚠️ Exception: Avoid Concurrent Duplicate Calls

**The only time hook repetition is problematic:** Multiple components render simultaneously with the same entity ID before cache is populated.

```typescript
// ❌ Problem: Both components render at same time, cache is empty
const Parent = ({ userId }: { userId: string }) => {
  return (
    <>
      <UserProfile userId={userId} />   {/* Makes API call */}
      <UserSettings userId={userId} />  {/* Also makes API call! */}
    </>
  );
};

const UserProfile = ({ userId }: { userId: string }) => {
  const { entity: user } = useEntity('user', userId);  // API call 1
  return <div>{user?.data.name}</div>;
};

const UserSettings = ({ userId }: { userId: string }) => {
  const { entity: user } = useEntity('user', userId);  // API call 2 (duplicate!)
  return <div>{user?.data.email}</div>;
};
```

**Solutions:**

**Option 1: Parent fetches, passes ID (not data)**
```typescript
const Parent = ({ userId }: { userId: string }) => {
  const { entity: user, isLoading } = useEntity('user', userId);
  
  if (isLoading) return <Loading />;
  
  // Now cache is populated, children get from cache
  return (
    <>
      <UserProfile userId={userId} />
      <UserSettings userId={userId} />
    </>
  );
};
```

**Option 2: Use conditional rendering**
```typescript
const Parent = ({ userId }: { userId: string }) => {
  const [isReady, setIsReady] = useState(false);
  
  useEffect(() => {
    // Pre-populate cache
    getEntity('user', userId).then(() => setIsReady(true));
  }, [userId]);
  
  if (!isReady) return <Loading />;
  
  return (
    <>
      <UserProfile userId={userId} />
      <UserSettings userId={userId} />
    </>
  );
};
```

**Option 3: Accept the race condition** (usually fine)
- Duplicate calls only happen on initial load
- Both receive same data
- Subsequent renders use cache
- De-duplicate at HTTP layer if needed

### Summary

| Pattern | Recommendation |
|---------|----------------|
| Pass entity ID to child | ✅ Preferred |
| Pass entity data to child | ⚠️ Avoid - use hook in child instead |
| Pass mutual ID to child | ✅ Preferred |
| Pass mutual data to child | ⚠️ Avoid - use hook in child instead |
| Multiple hooks same ID (sequential) | ✅ Fine - cache hit |
| Multiple hooks same ID (concurrent) | ⚠️ May cause duplicate API calls |

## Hook Reference

### Entity Hooks

#### `useEntity(entityType, entityId, options)`

Fetch and subscribe to a single entity by ID.

```typescript
const { entity, isLoading, error, refetch } = useEntity('user', userId);

// Access entity data
const userName = entity?.data.name;
const userId = entity?.entityId;
```

**When to use:**
- Displaying a single record (user profile, product detail, etc.)
- Need reactive updates when entity changes
- Form pre-population with existing data

**Avoid when:**
- Data is already available from parent via props or mutual
- Only need static data for initial render (use `getEntity` action instead)

#### `useEntityByUniqueField(entityType, fieldName, value, options)`

Fetch entity by a unique field (e.g., email, slug).

```typescript
const { entity, isLoading } = useEntityByUniqueField('user', 'email', 'john@example.com');
```

#### `useEntities(entityType, params, options)`

List entities with search, pagination, and sorting support.

```typescript
const {
  entities,
  entitiesMap,
  isLoading,
  searchField,
  listMore,
  refetch
} = useEntities('user', {
  limit: 20,
  all: false,      // Set true to fetch all without pagination
  skRange: {       // For sorted/range queries
    start: '2024-01-01',
    end: '2024-12-31'
  }
});

// Built-in search field binding
<input {...searchField} placeholder="Search users..." />
```

**Key features:**
- Automatic pagination with `listMore()`
- Built-in search with debouncing
- Reactive to store updates

### Mutual Hooks

#### `useMutual(byEntityType, entityType, byEntityId, entityId, options)`

Fetch a specific mutual relationship.

```typescript
const { mutual, isLoading } = useMutual(
  'student',
  'course',
  studentId,
  courseId
);

// Access mutual data
const enrollmentDate = mutual?.mutualData.enrolledAt;
const grade = mutual?.mutualData.grade;

// Access the related entity data
const courseData = mutual?.data;  // The course entity data
```

#### `useMutuals(byEntityType, entityType, byEntityId, options, chainEntityQuery?)`

List all mutuals for an entity (e.g., all courses for a student).

```typescript
const {
  mutuals,
  mutualsMap,
  isLoading,
  listMore,
  refetch
} = useMutuals('student', 'course', studentId);

// Render list with both mutual and entity data
mutuals.map(mutual => (
  <CourseCard
    key={mutual.entityId}
    course={mutual.data}           // The course entity
    enrolledAt={mutual.mutualData.enrolledAt}
    grade={mutual.mutualData.grade}
  />
));
```

**Chain entity query:** Use for complex relationship filtering via prejoins.

### Tag Hooks

#### `useTaggedEntities(entityType, tagName, options)`

Query entities by tag with group/range filtering.

```typescript
const { entities, isLoading, listMore } = useTaggedEntities(
  'organization',
  'region',
  {
    params: {
      group: 'eu-west-1',        // Filter by group
      start: '2024-01-01',       // Range query on sortValue
      end: '2024-12-31',
      limit: 20
    }
  }
);
```

**Common tag patterns:**
- Status tags: `status#active`, `status#pending`
- Temporal tags: `createdAt#2024-01-15`, `month#2024-01`
- Category tags: `region#eu-west`, `type#premium`

## Action Functions

For imperative operations (create, update, delete), use action functions instead of hooks:

```typescript
import Monorise from '@monorise/react';

// Destructure needed actions
const { createEntity, editEntity, deleteEntity, createMutual, editMutual, deleteMutual, getEntity } = Monorise;

// In event handlers or async functions
const handleCreate = async (values) => {
  const { data, error } = await createEntity('user', values);
  if (data) {
    // Success - entity automatically added to store
  }
};

const handleUpdate = async (userId, values) => {
  const { data, error } = await editEntity('user', userId, values);
  // All subscribed components auto-update
};

const handleDelete = async (userId) => {
  const { data, error } = await deleteEntity('user', userId);
  // Entity removed from all stores automatically
};

// For one-time fetch without subscription
const loadUser = async (userId) => {
  const { data } = await getEntity('user', userId);
  return data;
};
```

## Common Patterns

### Pattern 1: Master-Detail List

```typescript
// Parent component lists entities
const UserList = () => {
  const { entities, isLoading } = useEntities('user', { limit: 20 });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div>
      {entities.map(user => (
        <UserRow
          key={user.entityId}
          user={user}
          onClick={() => setSelectedId(user.entityId)}
        />
      ))}
      {selectedId && <UserDetail userId={selectedId} />}
    </div>
  );
};

// Child component fetches full details
const UserDetail = ({ userId }: { userId: string }) => {
  const { entity: user, isLoading } = useEntity('user', userId);
  // Automatically re-fetches when userId changes
  return <div>{user?.data.name}</div>;
};
```

### Pattern 2: Managing Relationships

```typescript
const CourseEnrollment = ({ studentId, courseId }: { studentId: string; courseId: string }) => {
  // Check existing enrollment
  const { mutual, isLoading } = useMutual('student', 'course', studentId, courseId);

  const handleEnroll = async () => {
    await createMutual('student', 'course', studentId, courseId, {
      enrolledAt: new Date().toISOString(),
      status: 'active'
    });
  };

  const handleUpdateGrade = async (grade: string) => {
    await editMutual('student', 'course', studentId, courseId, {
      ...mutual?.mutualData,
      grade
    });
  };

  const handleUnenroll = async () => {
    await deleteMutual('student', 'course', studentId, courseId);
  };

  return (
    <div>
      {mutual ? (
        <>
          <p>Enrolled: {mutual.mutualData.enrolledAt}</p>
          <button onClick={() => handleUpdateGrade('A')}>Set Grade A</button>
          <button onClick={handleUnenroll}>Unenroll</button>
        </>
      ) : (
        <button onClick={handleEnroll}>Enroll</button>
      )}
    </div>
  );
};
```

### Pattern 3: List with Related Data

```typescript
const StudentCourseList = ({ studentId }: { studentId: string }) => {
  // Gets all courses for this student via mutuals
  const { mutuals, isLoading } = useMutuals('student', 'course', studentId);

  if (isLoading) return <Loading />;

  return (
    <div>
      {mutuals.map(mutual => (
        <CourseCard
          key={mutual.entityId}
          course={mutual.data}           // Original course entity
          enrollmentDate={mutual.mutualData.enrolledAt}
          grade={mutual.mutualData.grade}
        />
      ))}
    </div>
  );
};
```

### Pattern 4: Tag-Based Filtering

```typescript
const ActiveUsersList = () => {
  const { entities, isLoading } = useTaggedEntities('user', 'status', {
    params: { group: 'active' }
  });

  return (
    <div>
      <h2>Active Users</h2>
      {entities.map(user => (
        <UserCard key={user.entityId} user={user} />
      ))}
    </div>
  );
};

// Date range query using sortValue
const RecentOrders = () => {
  const { entities } = useTaggedEntities('order', 'createdAt', {
    params: {
      start: '2024-01-01',
      end: '2024-01-31'
    }
  });
  // Returns orders created in January 2024
};
```

### Pattern 5: Form with Entity Pre-population

```typescript
const UserEditForm = ({ userId }: { userId: string }) => {
  const { entity: user, isLoading } = useEntity('user', userId);
  const [formData, setFormData] = useState({ name: '', email: '' });

  // Pre-populate form when entity loads
  useEffect(() => {
    if (user) {
      setFormData({
        name: user.data.name || '',
        email: user.data.email || ''
      });
    }
  }, [user]);

  const handleSubmit = async () => {
    await editEntity('user', userId, formData);
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        value={formData.name}
        onChange={e => setFormData({ ...formData, name: e.target.value })}
      />
      <button type="submit">Save</button>
    </form>
  );
};
```

### Pattern 6: Optimistic Local Updates

For immediate UI feedback before server confirmation:

```typescript
const { updateLocalEntity, updateLocalTaggedEntity } = Monorise;

// Update entity in store immediately
const handleOptimisticUpdate = async (userId: string, newData: Partial<UserData>) => {
  // Update local store immediately
  updateLocalEntity('user', userId, newData);

  // Fire actual request
  const { error } = await editEntity('user', userId, newData);

  if (error) {
    // Handle error - entity will be reverted on next fetch
    // or manually revert if needed
  }
};

// Update in tag store
updateLocalTaggedEntity('user', userId, 'status', newData, { group: 'active' });
```

## Anti-Patterns to Avoid

### ❌ Don't use useEffect for data fetching

```typescript
// WRONG - Don't do this
const [user, setUser] = useState(null);
useEffect(() => {
  fetch(`/api/users/${userId}`)
    .then(r => r.json())
    .then(setUser);
}, [userId]);
```

```typescript
// CORRECT - Use Monorise hook
const { entity: user, isLoading } = useEntity('user', userId);
```

### ❌ Don't manage entity lists in component state

```typescript
// WRONG - Don't do this
const [users, setUsers] = useState([]);
useEffect(() => {
  fetch('/api/users').then(r => r.json()).then(setUsers);
}, []);
```

```typescript
// CORRECT - Use Monorise hook
const { entities, isLoading, listMore } = useEntities('user', { limit: 20 });
```

### ❌ Don't fetch relationships manually

```typescript
// WRONG - Don't do this
const [courses, setCourses] = useState([]);
useEffect(() => {
  fetch(`/api/students/${studentId}/courses`).then(...);
}, [studentId]);
```

```typescript
// CORRECT - Use mutual hook
const { mutuals } = useMutuals('student', 'course', studentId);
// mutuals already contain course data via mutual.data
```

### ❌ Don't duplicate entity data in component state

```typescript
// WRONG - Don't do this
const { entity } = useEntity('user', userId);
const [userName, setUserName] = useState('');
useEffect(() => {
  if (entity) setUserName(entity.data.name);
}, [entity]);
```

```typescript
// CORRECT - Use entity data directly
const { entity } = useEntity('user', userId);
// entity.data.name is already reactive
```

## Store Access (Advanced)

For direct store access outside of hooks:

```typescript
import Monorise from '@monorise/react';

const { store, useEntityState } = Monorise;

// Subscribe to specific entity state
const entityState = useEntityState('user');
// Returns: { dataMap: Map<string, CreatedEntity>, isFirstFetched: boolean, lastKey?: string }

// Direct store access (non-reactive)
const currentState = store.getState();
const user = currentState.entity.user.dataMap.get(userId);
```

## Error Handling

All hooks and actions provide consistent error handling:

```typescript
const { entity, error, isLoading } = useEntity('user', userId);

if (isLoading) return <Loading />;
if (error) return <Error message={error.message} />;
if (!entity) return <NotFound />;

return <UserProfile user={entity} />;
```

For actions:

```typescript
const handleAction = async () => {
  const { data, error } = await createEntity('user', values);

  if (error) {
    // Handle error (show toast, set form errors, etc.)
    return;
  }

  // Success - navigate away, show success message, etc.
};
```

## TypeScript Tips

Define your entity types for type safety:

```typescript
// types/entities.ts
import { Entity, EntitySchemaMap } from '@monorise/base';

declare module '@monorise/base' {
  export enum Entity {
    USER = 'user',
    COURSE = 'course',
    STUDENT = 'student'
  }

  export interface EntitySchemaMap {
    user: {
      name: string;
      email: string;
      role: 'admin' | 'user';
    };
    course: {
      title: string;
      description: string;
    };
    student: {
      studentId: string;
      enrolledAt: string;
    };
  }
}
```

Hooks are fully typed:

```typescript
const { entity } = useEntity('user', userId);
// entity is CreatedEntity<'user'> | undefined
// entity.data is { name: string; email: string; role: 'admin' | 'user' }
```
