# Mutuals

A **mutual** is a relationship between two entities where the relationship itself holds meaningful data. Rather than just linking two entities together, mutuals capture **context** — such as timestamps, roles, or statuses — that lives on the relationship itself.

## Key characteristics

- Represents a **relationship** between two distinct entities
- The relationship itself can **store data** (e.g., roles, timestamps, status)
- Supports querying **from either direction** — just swap the arguments
- Can be **converted into a standalone entity** when richer modeling is needed
- Enables **flexible relationship modeling**, such as many-to-many or stateful interactions

## Example

Imagine a database for a school:

- `Student` is an entity
- `Course` is an entity
- An **enrollment** mutual connects them

Instead of just linking them, you may want to store:

- Date of enrollment
- Grade
- Completion status

Now `Enrollment` becomes a **mutual**, holding data about the relationship. Later, you can even **promote Enrollment to a full entity** — which allows it to have its own tags or mutuals (like approvals or certifications).

## Defining mutuals

Mutuals are configured within an entity's config. You need to define both sides — the student knows about courses, and the course knows about students:

**Student config:**

```ts
const config = createEntityConfig({
  name: 'student',
  displayName: 'Student',
  baseSchema,
  mutual: {
    mutualSchema: z
      .object({
        courseIds: z.string().array(),
      })
      .partial(),
    mutualFields: {
      courseIds: {
        entityType: Entity.COURSE,
      },
    },
  },
});
```

**Course config:**

```ts
const config = createEntityConfig({
  name: 'course',
  displayName: 'Course',
  baseSchema,
  mutual: {
    mutualSchema: z
      .object({
        studentIds: z.string().array(),
      })
      .partial(),
    mutualFields: {
      studentIds: {
        entityType: Entity.STUDENT,
      },
    },
  },
});
```

When you create a student with `courseIds: ['course-1', 'course-2']`, monorise automatically creates the mutual records in **both directions**.

## Querying mutuals (API)

```
# List all courses for a student
GET /core/mutual/student/:studentId/course

# List all students in a course
GET /core/mutual/course/:courseId/student

# Get a specific mutual relationship
GET /core/mutual/student/:studentId/course/:courseId
```

## Querying mutuals (React)

Use the `useMutuals` hook. The key insight: **swap the arguments to query the reverse direction**.

### List related entities

```ts
// All courses for a student
const { mutuals: courses, isLoading } = useMutuals(
  Entity.STUDENT,   // byEntityType
  Entity.COURSE,    // entityType
  studentId,        // byEntityId
);

// courses[0].data → course data (name, description, etc.)
// courses[0].entityId → course ID
// courses[0].mutualData → relationship data
```

### Reverse direction — just swap the arguments

```ts
// All students in a course — same hook, swapped arguments
const { mutuals: students, isLoading } = useMutuals(
  Entity.COURSE,    // byEntityType (swapped)
  Entity.STUDENT,   // entityType (swapped)
  courseId,         // byEntityId
);

// students[0].data → student data (name, email, etc.)
// students[0].entityId → student ID
```

::: tip
You don't need any extra configuration to query the reverse direction. Monorise stores mutual records in both directions automatically, so `useMutuals(A, B, aId)` and `useMutuals(B, A, bId)` both work out of the box.
:::

### Get a single mutual

```ts
const { mutual, isLoading } = useMutual(
  Entity.STUDENT,
  Entity.COURSE,
  studentId,
  courseId,
);

// mutual.data → course data
// mutual.mutualData → relationship-specific data (grade, enrollment date, etc.)
```

### Pagination

```ts
const { mutuals, lastKey, listMore } = useMutuals(
  Entity.STUDENT,
  Entity.COURSE,
  studentId,
);

// Load more when user scrolls to bottom
if (lastKey) {
  listMore();
}
```

### Creating mutuals

When creating an entity, include the mutual field IDs to automatically create relationships:

```ts
// Creating a student enrolled in two courses
await createEntity(Entity.STUDENT, {
  name: 'Alice',
  email: 'alice@school.com',
  courseIds: [courseId1, courseId2],
});
```

Or create a mutual relationship directly:

```ts
await createMutual(
  Entity.STUDENT,
  Entity.COURSE,
  studentId,
  courseId,
  { grade: 'A', enrolledAt: new Date().toISOString() }, // mutual data
);
```

## Mutual data

Each mutual object returned by hooks contains:

```ts
{
  entityId: string;         // the related entity's ID
  entityType: Entity;       // the related entity's type
  byEntityId: string;       // the source entity's ID
  byEntityType: Entity;     // the source entity's type
  mutualId: string;         // unique mutual record ID
  data: EntitySchemaMap[T]; // the related entity's data (strongly typed)
  mutualData: {};           // relationship-specific data
  createdAt: string;
  updatedAt: string;
  mutualUpdatedAt: string;
}
```

## Advanced: `toMutualIds`

By default, each field in `mutualSchema` is expected to be a plain array of entity IDs:

```ts
mutualSchema: z.object({
  courseIds: z.string().array(), // ['course-1', 'course-2']
}).partial(),
mutualFields: {
  courseIds: { entityType: Entity.COURSE },
},
```

Sometimes you need to pass richer data alongside the IDs — for example, a role or status per relationship. Use `toMutualIds` to extract the IDs from a complex payload:

```ts
mutual: {
  mutualSchema: z.object({
    enrollments: z.array(z.object({
      courseId: z.string(),
      role: z.enum(['student', 'auditor']),
    })).optional(),
  }).partial(),
  mutualFields: {
    enrollments: {
      entityType: Entity.COURSE,
      toMutualIds: (payload) => payload.map((e) => e.courseId),
    },
  },
},
```

When you create the entity:

```ts
await createEntity(Entity.STUDENT, {
  name: 'Alice',
  enrollments: [
    { courseId: 'course-1', role: 'student' },
    { courseId: 'course-2', role: 'auditor' },
  ],
});
```

Monorise calls `toMutualIds(payload)` to get `['course-1', 'course-2']` and creates the mutual records. The original payload is forwarded as `customContext` to `mutualDataProcessor` (see below), so you can use it to store per-relationship data.

## Advanced: `mutualDataProcessor`

By default, `mutualData` on each mutual record is an empty object `{}`. Use `mutualDataProcessor` to compute data that should be stored on the relationship itself.

**Signature:**

```ts
mutualDataProcessor: (
  mutualIds: string[],
  currentMutual: Mutual,
  customContext?: Record<string, any>,
) => Record<string, any>
```

- `mutualIds` — all entity IDs in this batch
- `currentMutual` — the Mutual object being created/updated (contains `byEntityType`, `byEntityId`, `entityType`, `entityId`, and entity data from both sides)
- `customContext` — the original payload when `toMutualIds` is used; empty object otherwise

**Example — store a role on each enrollment:**

```ts
mutual: {
  mutualSchema: z.object({
    enrollments: z.array(z.object({
      courseId: z.string(),
      role: z.enum(['student', 'auditor']),
    })).optional(),
  }).partial(),
  mutualFields: {
    enrollments: {
      entityType: Entity.COURSE,
      toMutualIds: (payload) => payload.map((e) => e.courseId),
      mutualDataProcessor: (mutualIds, currentMutual, customContext) => {
        const enrollment = customContext?.find(
          (e) => e.courseId === currentMutual.entityId,
        );
        return {
          role: enrollment?.role ?? 'student',
          enrolledAt: new Date().toISOString(),
        };
      },
    },
  },
},
```

The returned object becomes the `mutualData` on the mutual record, accessible via `mutual.mutualData` when querying:

```ts
const { mutuals: courses } = useMutuals(
  Entity.STUDENT,
  Entity.COURSE,
  studentId,
);

// courses[0].mutualData → { role: 'student', enrolledAt: '2026-04-24T...' }
```

::: tip
`mutualDataProcessor` runs for both newly created and existing mutual records during an update. This means you can change relationship data by re-submitting the mutual payload.
:::

## Data layout

| Pattern | Key structure |
|---------|---------------|
| Mutual record | `MUTUAL#<id>` primary item |
| Directional lookup | `byEntity -> entity` and the reverse |
