---
name: monorise-react-reviewer
description: Review React frontend implementations for correct Monorise pattern usage. Use when auditing, reviewing, or evaluating React code that uses Monorise hooks. Identifies incorrect use of useEffect/useState instead of Monorise hooks, improper entity/mutual/tag patterns, props drilling anti-patterns, missing error handling, and state management anti-patterns.
---

# Monorise React Reviewer

Guide for reviewing React implementations to ensure correct Monorise pattern usage.

## Review Checklist

### 1. Data Fetching Patterns

#### ❌ INCORRECT: Using useEffect for entity fetching

```typescript
// VIOLATION: Manual fetch with useEffect
const UserProfile = ({ userId }: { userId: string }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/core/entity/user/${userId}`)
      .then(r => r.json())
      .then(data => {
        setUser(data);
        setLoading(false);
      });
  }, [userId]);

  if (loading) return <Loading />;
  return <div>{user?.data.name}</div>;
};
```

**Issues:**
- No automatic caching
- No store synchronization
- Duplicate requests possible
- No built-in error handling
- Manual loading state management

#### ✅ CORRECT: Using useEntity hook

```typescript
const UserProfile = ({ userId }: { userId: string }) => {
  const { entity: user, isLoading, error } = useEntity('user', userId);

  if (isLoading) return <Loading />;
  if (error) return <Error message={error.message} />;
  if (!user) return <NotFound />;

  return <div>{user.data.name}</div>;
};
```

---

### 2. Props Drilling vs Hooks (Component Data Flow)

#### ❌ INCORRECT: Passing entity/mutual data via props

```typescript
// VIOLATION: Props drilling entity data
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

// Child receives entity data - becomes stale on external updates
const OrgHeader = ({ org }: { org: CreatedEntity<'organization'> }) => {
  return <h1>{org.data.name}</h1>;  // Stale if org updated elsewhere!
};

// Child receives mutual data - no reactivity to membership changes
const MemberList = ({ members }: { members: Mutual[] }) => {
  return members.map(m => <MemberCard key={m.entityId} member={m} />);
};
```

**Issues:**
- Data becomes stale if entity/mutual updated in other components
- No automatic re-rendering when relationships change
- Props threading through multiple layers becomes messy
- Child components not subscribed to store updates
- Violates Monorise's reactive architecture

#### ✅ CORRECT: Use hooks in child components with IDs

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

// Child fetches its own data from local cache
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

// Deep component gets its own data from cache
const MemberCard = ({ userId }: { userId: string }) => {
  const { entity: user } = useEntity('user', userId);
  // Fetches from cache instantly, no API call if already loaded
  return <div>{user?.data.name}</div>;
};
```

**Why this works:**
- Hooks check Zustand cache first (O(1) retrieval, no network request)
- Each component subscribes to its own data slice
- Optimistic updates propagate immediately to all subscribers
- Backend denormalization is async; local cache updates sync

#### ⚠️ WARNING: Concurrent duplicate hook calls

```typescript
// VIOLATION: Multiple components may cause duplicate API calls
const Parent = ({ userId }: { userId: string }) => {
  return (
    <>
      <UserProfile userId={userId} />   {/* Renders, cache empty, API call */}
      <UserSettings userId={userId} />  {/* Also renders, cache still empty, API call! */}
    </>
  );
}

const UserProfile = ({ userId }: { userId: string }) => {
  const { entity: user } = useEntity('user', userId);  // API call 1
  return <div>{user?.data.name}</div>;
};

const UserSettings = ({ userId }: { userId: string }) => {
  const { entity: user } = useEntity('user', userId);  // API call 2 (duplicate!)
  return <div>{user?.data.email}</div>;
};
```

**Issues:**
- Both components render simultaneously before cache populated
- Duplicate concurrent API calls for same entity
- Wasteful but not harmful (both receive same data)

#### ✅ CORRECT: Parent pre-fetches to populate cache

```typescript
// Parent fetches first, blocks children until cached
const Parent = ({ userId }: { userId: string }) => {
  const { isLoading } = useEntity('user', userId);
  
  if (isLoading) return <Loading />;
  
  // Cache now populated, children get instant cache hit
  return (
    <>
      <UserProfile userId={userId} />   {/* Cache hit - no API call */}
      <UserSettings userId={userId} />  {/* Cache hit - no API call */}
    </>
  );
};

const UserProfile = ({ userId }: { userId: string }) => {
  const { entity: user } = useEntity('user', userId);  // From cache
  return <div>{user?.data.name}</div>;
};
```

---

### 3. List Data Patterns

#### ❌ INCORRECT: Managing entity lists in component state

```typescript
// VIOLATION: Manual list management
const UserList = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [page, setPage] = useState(1);

  useEffect(() => {
    fetch(`/api/core/entity/user?page=${page}`)
      .then(r => r.json())
      .then(data => setUsers(prev => [...prev, ...data.data]));
  }, [page]);

  return (
    <>
      {users.map(u => <UserCard key={u.entityId} user={u} />)}
      <button onClick={() => setPage(p => p + 1)}>Load More</button>
    </>
  );
};
```

**Issues:**
- List not synchronized with store
- Other components creating users won't appear
- Manual pagination logic
- No search integration

#### ✅ CORRECT: Using useEntities hook

```typescript
const UserList = () => {
  const { entities, isLoading, listMore, lastKey } = useEntities('user', { limit: 20 });

  return (
    <>
      {entities.map(u => <UserCard key={u.entityId} user={u} />)}
      {lastKey && <button onClick={listMore}>Load More</button>}
    </>
  );
};
```

---

### 4. Relationship Data Patterns

#### ❌ INCORRECT: Fetching relationships manually

```typescript
// VIOLATION: Manual relationship fetching
const StudentCourses = ({ studentId }: { studentId: string }) => {
  const [courses, setCourses] = useState<Course[]>([]);

  useEffect(() => {
    fetch(`/api/core/mutual/student/${studentId}/course`)
      .then(r => r.json())
      .then(data => setCourses(data.entities));
  }, [studentId]);

  return courses.map(c => <CourseCard key={c.entityId} course={c} />);
};
```

**Issues:**
- Missing mutual data (enrollment date, grade, etc.)
- No bidirectional relationship handling
- Manual cache management
- Stale data when relationships change

#### ✅ CORRECT: Using useMutuals hook

```typescript
const StudentCourses = ({ studentId }: { studentId: string }) => {
  const { mutuals, isLoading } = useMutuals('student', 'course', studentId);

  return mutuals.map(mutual => (
    <CourseCard
      key={mutual.entityId}
      course={mutual.data}           // Course entity data
      enrolledAt={mutual.mutualData.enrolledAt}
      grade={mutual.mutualData.grade}
    />
  ));
};
```

---

### 5. Duplicate State Patterns

#### ❌ INCORRECT: Duplicating entity data in useState

```typescript
// VIOLATION: Copying entity data to local state
const UserEditor = ({ userId }: { userId: string }) => {
  const { entity: user } = useEntity('user', userId);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  useEffect(() => {
    if (user) {
      setName(user.data.name);
      setEmail(user.data.email);
    }
  }, [user]);

  const handleSave = async () => {
    await editEntity('user', userId, { name, email });
  };

  // ... form JSX
};
```

**Issues:**
- Unnecessary state duplication
- Risk of state getting out of sync
- More complex code

#### ✅ CORRECT: Using form state only for edits

```typescript
const UserEditor = ({ userId }: { userId: string }) => {
  const { entity: user, isLoading } = useEntity('user', userId);
  const [formData, setFormData] = useState({ name: '', email: '' });

  // Only sync when user data first loads or changes externally
  useEffect(() => {
    if (user) {
      setFormData({
        name: user.data.name || '',
        email: user.data.email || ''
      });
    }
  }, [user?.entityId]); // Only re-sync when entityId changes

  const handleSave = async () => {
    const { error } = await editEntity('user', userId, formData);
    if (!error) {
      // Success - no need to update form, entity will update via subscription
    }
  };

  return (
    <form>
      <input
        value={formData.name}
        onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
      />
      <button onClick={handleSave}>Save</button>
    </form>
  );
};
```

---

### 6. Entity Creation/Update Patterns

#### ❌ INCORRECT: Not using Monorise actions

```typescript
// VIOLATION: Manual API calls for mutations
const CreateUserForm = () => {
  const handleSubmit = async (values: UserInput) => {
    const response = await fetch('/api/core/entity/user', {
      method: 'POST',
      body: JSON.stringify(values)
    });
    const newUser = await response.json();
    // New user won't appear in useEntities lists!
    // Need to manually refresh or navigate
  };
};
```

**Issues:**
- Created entity not added to store
- Lists won't auto-update
- No loading/error feedback integration
- Manual cache invalidation needed

#### ✅ CORRECT: Using Monorise actions

```typescript
const CreateUserForm = () => {
  const handleSubmit = async (values: UserInput) => {
    const { data, error } = await createEntity('user', values);

    if (error) {
      message.error(error.message);
      return;
    }

    // Entity automatically added to all relevant stores
    // Lists using useEntities will auto-update
    router.push(`/users/${data.entityId}`);
  };
};
```

---

### 7. Error Handling Patterns

#### ❌ INCORRECT: Missing error handling

```typescript
// VIOLATION: No error handling
const UserProfile = ({ userId }: { userId: string }) => {
  const { entity: user, isLoading } = useEntity('user', userId);

  if (isLoading) return <Loading />;
  return <div>{user.data.name}</div>; // Crashes if entity is undefined!
};
```

#### ✅ CORRECT: Proper error and null handling

```typescript
const UserProfile = ({ userId }: { userId: string }) => {
  const { entity: user, isLoading, error } = useEntity('user', userId);

  if (isLoading) return <Loading />;
  if (error) return <ErrorAlert error={error} />;
  if (!user) return <NotFound />;

  return <div>{user.data.name}</div>;
};
```

---

### 8. Tag Usage Patterns

#### ❌ INCORRECT: Filtering entities client-side

```typescript
// VIOLATION: Client-side filtering of large datasets
const ActiveUsers = () => {
  const { entities: allUsers } = useEntities('user'); // Fetches all!
  const activeUsers = allUsers.filter(u => u.data.status === 'active');

  return activeUsers.map(u => <UserCard key={u.entityId} user={u} />);
};
```

**Issues:**
- Loads all entities when only subset needed
- Inefficient for large datasets
- No pagination support

#### ✅ CORRECT: Using tags for server-side filtering

```typescript
const ActiveUsers = () => {
  // Only fetches users tagged as active
  const { entities: activeUsers, isLoading } = useTaggedEntities(
    'user',
    'status',
    { params: { group: 'active' } }
  );

  return activeUsers.map(u => <UserCard key={u.entityId} user={u} />);
};
```

---

### 9. Mutual Management Patterns

#### ❌ INCORRECT: Storing relationship IDs in entity

```typescript
// VIOLATION: Manual ID management
const CourseManager = ({ studentId }: { studentId: string }) => {
  const { entity: student } = useEntity('student', studentId);
  const [courseIds, setCourseIds] = useState<string[]>([]);

  useEffect(() => {
    if (student?.data.courseIds) {
      setCourseIds(student.data.courseIds);
    }
  }, [student]);

  const handleAddCourse = async (courseId: string) => {
    await editEntity('student', studentId, {
      courseIds: [...courseIds, courseId]
    });
    setCourseIds([...courseIds, courseId]);
  };
};
```

**Issues:**
- Violates Monorise relationship model
- No mutual data storage (enrollment date, etc.)
- Manual bidirectional sync required
- No atomic operations

#### ✅ CORRECT: Using mutuals for relationships

```typescript
const CourseManager = ({ studentId }: { studentId: string }) => {
  const { mutuals, refetch } = useMutuals('student', 'course', studentId);

  const handleEnroll = async (courseId: string) => {
    const { error } = await createMutual('student', 'course', studentId, courseId, {
      enrolledAt: new Date().toISOString(),
      status: 'active'
    });

    if (!error) {
      // List auto-updates, no manual refetch needed
    }
  };

  const handleUnenroll = async (courseId: string) => {
    await deleteMutual('student', 'course', studentId, courseId);
    // List auto-updates
  };

  return (
    <>
      {mutuals.map(mutual => (
        <EnrolledCourse
          key={mutual.entityId}
          course={mutual.data}
          enrolledAt={mutual.mutualData.enrolledAt}
          onUnenroll={() => handleUnenroll(mutual.entityId)}
        />
      ))}
    </>
  );
};
```

---

## Review Severity Levels

### 🔴 Critical (Must Fix)

- Using `useEffect` + `fetch` for entity data that should use Monorise hooks (Section 1)
- Manual state management for entity lists instead of `useEntities` (Section 3)
- Storing relationship data as arrays in entities instead of using mutuals (Section 9)
- Missing error handling causing potential runtime crashes (Section 7)
- Passing entity/mutual data through props causing stale data issues (Section 2)

### 🟡 Warning (Should Fix)

- Duplicating entity data in component state unnecessarily (Section 5)
- Client-side filtering of large datasets instead of using tags (Section 8)
- Manual cache invalidation instead of relying on store updates
- Not using `listMore` for pagination (Section 3)
- Concurrent duplicate hook calls without parent pre-fetch (Section 2)

### 🟢 Suggestion (Consider)

- Could use `useEntityByUniqueField` instead of `useEntity` for slug-based routing
- Could simplify by using `searchField` from `useEntities` instead of custom search
- Could use optimistic updates with `updateLocalEntity`

## Review Report Template

When providing a review, structure findings as:

```markdown
## Monorise Pattern Review

### Summary
- Critical issues: 2
- Warnings: 3
- Suggestions: 1

### Critical Issues

#### 1. [File]:[Line] - Manual entity fetching
**Current:**
\`\`\`typescript
// problematic code
\`\`\`

**Issue:** [Explanation]

**Recommended:**
\`\`\`typescript
// corrected code
\`\`\`

### Warnings

#### 1. [File]:[Line] - [Issue title]
...

### Suggestions

#### 1. [File]:[Line] - [Suggestion title]
...
```

## Common Review Scenarios

### Scenario 1: New Component Review

Check for:
1. Is it using `useEntity`/`useEntities` for data?
2. Are mutations using `createEntity`/`editEntity`/`deleteEntity`?
3. Is error handling present?
4. Are relationships using `useMutual`/`useMutuals`?
5. Are child components receiving IDs (not data) via props? (Section 2)

### Scenario 2: Refactoring Review

Check for:
1. Removed `useEffect` fetch calls
2. Removed manual state management
3. Proper use of Monorise hooks
4. No regression in error handling
5. Props drilling replaced with hook usage in child components (Section 2)

### Scenario 3: Feature Addition Review

Check for:
1. New entity types properly configured
2. Mutual relationships correctly modeled
3. Tags used for appropriate access patterns
4. No mixing of patterns (Monorise + custom fetch)
5. Component hierarchy uses ID-passing pattern (Section 2)
