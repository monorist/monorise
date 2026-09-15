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

For new projects, define relationship data once with `createMutualConfig` and reference that config from both entity sides. This gives `mutualData` one Zod schema for direct creates, updates, and processor output.

`mutualSchema` and `mutualDataSchema` validate different inputs:

```text
student.courseIds / course.studentIds  -> entity input fields
enrollmentMutual.mutualDataSchema      -> data stored on the relationship
```

```ts
import { createEntityConfig, createMutualConfig } from 'monorise/base';

const enrollmentMutual = createMutualConfig({
  name: 'enrollment',
  entities: [Entity.STUDENT, Entity.COURSE],
  mutualDataSchema: z.object({
    role: z.enum(['student', 'auditor']),
    enrolledAt: z.string().datetime(),
  }),
});
```

**Student config:**

```ts
const config = createEntityConfig({
  name: 'student',
  displayName: 'Student',
  baseSchema,
  mutual: {
    mutualSchema: z.object({
      courseIds: z.string().array(),
    }).partial(),
    mutualFields: {
      courseIds: {
        entityType: Entity.COURSE,
        mutual: enrollmentMutual,
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
    mutualSchema: z.object({
      studentIds: z.string().array(),
    }).partial(),
    mutualFields: {
      studentIds: {
        entityType: Entity.STUDENT,
        mutual: enrollmentMutual,
      },
    },
  },
});
```

::: tip Backward compatibility
`createMutualConfig` was introduced after mutuals existed, so it remains optional. Existing inline mutual configurations continue to work and accept unvalidated `mutualData`. For new relationships that carry data, use a shared config from the start.
:::

## Requiring a mutual field only on create

`mutualSchema` validates the same payload shape on both create and update. That's a tradeoff: making a field required so a create can't skip it also forces every future *update* to resend that field, even for edits that have nothing to do with the relationship. Keeping it `.partial()` avoids that, but then a create can silently omit a required link — the entity is created, but never wired to the relationship, with no error anywhere.

`createMutualSchema` is an optional, stricter sibling of `mutualSchema` that's validated **only on create**. When present, its shape is merged into `mutualSchema` for the create payload — so any mutual field `mutualSchema` declares but `createMutualSchema` doesn't repeat is still validated and wired, and `createMutualSchema` only needs to list the field(s) it's tightening. `mutualSchema` itself keeps validating updates as normal.

```ts
const config = createEntityConfig({
  name: 'student',
  displayName: 'Student',
  baseSchema,
  mutual: {
    // Still partial — an update to a student's name shouldn't have to
    // resend courseIds.
    mutualSchema: z.object({
      courseIds: z.string().array(),
    }).partial(),
    // Required, and non-empty — every student must be enrolled in at
    // least one course from the moment they're created. `.array()` alone
    // would accept `courseIds: []`, satisfying "required" while still
    // enrolling in nothing — `.min(1)` closes that gap.
    createMutualSchema: z.object({
      courseIds: z.string().array().min(1),
    }),
    mutualFields: {
      courseIds: {
        entityType: Entity.COURSE,
        mutual: enrollmentMutual,
      },
    },
  },
});
```

With this in place, `createEntity(Entity.STUDENT, { name: 'Alice' })` throws a validation error instead of silently creating a student with no enrollment; `updateEntity(Entity.STUDENT, id, { name: 'Alicia' })` still succeeds without `courseIds`.

::: warning Upsert is strict or lenient depending on prior state
`PUT /entity/:type/:id` (upsert) applies `createMutualSchema` only when the entity doesn't already exist yet — the same request body can pass or fail validation for the same entity type depending purely on whether that ID was already there. If you're calling upsert generically (not specifically to create), account for the possibility that a payload missing a `createMutualSchema`-required field will be rejected the first time an ID is used, but accepted on every call after.
:::

::: tip Backward compatibility
`createMutualSchema` is optional. Configs that don't define it behave exactly as before — `mutualSchema` alone validates both create and update.
:::

When Athena analytics is enabled, a mutual relationship needs a lower-kebab-case `name` to receive typed analytics tables. It becomes the stable dataset name: `name: 'enrollment'` creates `enrollment_mutuals` for current state and `enrollment_mutual_changes` for history. Names must remain unique after SQL identifier normalization. Unnamed mutuals remain available to the core API but are skipped by analytics with a generator warning.

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

Create a mutual relationship directly with data that satisfies its shared config:

```ts
await createMutual(
  Entity.STUDENT,
  Entity.COURSE,
  studentId,
  courseId,
  { role: 'student', enrolledAt: new Date().toISOString() }, // mutual data
);
```

Because `enrollmentMutual` requires both fields, the call must provide both. Entity create and update operations can also create mutuals from fields such as `courseIds`. If the shared schema requires `mutualData`, use [`toMutualIds` with a `mutualDataProcessor`](#using-tomutualids-with-validated-data) so those writes produce valid relationship data.

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

## Mutual data validation

When `mutualDataSchema` is defined, it validates:

- **Direct mutual creation** — `createMutual()` API payload
- **Direct mutual update** — `updateMutual()` API payload
- **Processor output** — return value of `mutualDataProcessor` (if defined)

Invalid payloads will throw a Zod validation error.

Without `createMutualConfig`, existing relationships continue to accept any `mutualData` shape for backward compatibility.

## Using `toMutualIds` with validated data

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
      mutual: enrollmentMutual,
      toMutualIds: (payload) => payload.map((e) => e.courseId),
      mutualDataProcessor: (_mutualIds, currentMutual, customContext) => {
        const enrollments = customContext as Array<{
          courseId: string;
          role: 'student' | 'auditor';
        }>;
        const enrollment = enrollments?.find(
          (item) => item.courseId === currentMutual.entityId,
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

Monorise calls `toMutualIds(payload)` to get `['course-1', 'course-2']` and creates the mutual records. The original payload is forwarded to `mutualDataProcessor`, which returns data accepted by `enrollmentMutual.mutualDataSchema`.

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

## Advanced: materializing a mutual as an entity (`asEntity`)

By default, finding mutuals means scanning and filtering edges from one side (`GET /core/mutual/student/:studentId/course`, or the reverse). That's fine for "all courses for this student", but there's no way to ask "all enrollments with role `auditor`" without listing every mutual and filtering in application code.

`asEntity` solves this by materializing the mutual relationship itself as a real, independently-queryable `Entity` whenever it's created — whether imperatively via `MutualService.createMutual` or automatically via a declarative `mutualFields` entry that references the config. Once it's an entity, it can declare its own [`tags`](/concepts/tags) for indexed group/sort-value lookups, exactly like any other entity.

Set `asEntity` on `createMutualConfig` to the `createEntityConfig(...)` **return value** for the entity type the mutual should materialize as — not an `Entity` enum value:

```ts
const enrollmentEntityConfig = createEntityConfig({
  name: Entity.ENROLLMENT,
  displayName: 'Enrollment',
  baseSchema: z.object({ role: z.enum(['student', 'auditor']) }).partial(),
  createSchema: z.object({ role: z.enum(['student', 'auditor']) }),
});

const enrollmentMutual = createMutualConfig({
  entities: [Entity.STUDENT, Entity.COURSE],
  asEntity: enrollmentEntityConfig,
  ensureEntityStrongConsistentWrite: true, // default false
});
```

`mutualDataSchema` must be **omitted** when `asEntity` is set — it's derived automatically from `asEntity.finalSchema` (that entity's own `baseSchema` + `createSchema` + `effectiveMutualSchema`, merged, same as any normal `createEntity` payload validates against). Providing both `asEntity` and `mutualDataSchema` on the same config is a build-time and runtime error, so the mutual's data shape can never drift from the materialized entity's own shape.

When `asEntity` is set, creating the mutual also creates a real `Entity`: `entityType = asEntity.name`, `entityId = <the mutual's own generated ulid>`, `data = <the mutual's own parsed mutualData>`.

### Synchronous vs. asynchronous creation

`ensureEntityStrongConsistentWrite` controls when that entity is actually created:

- **`false` (default)** — entity creation is published as an async `CREATE_ENTITY` event and processed separately. Eventually consistent: there's a brief window after the mutual write where the entity doesn't exist yet. Cheaper, since it avoids widening the mutual write into a bigger transaction.
- **`true`** — the entity is created synchronously, in the **same DynamoDB transaction** as the mutual write, and its `afterCreateEntityHook` (tags/mutualFields wiring) fires immediately.

Reach for `ensureEntityStrongConsistentWrite: true` when your business flow reads the materialized entity right after creating the mutual (e.g. an immediate redirect to `GET /entity/enrollment/:id`) and can't tolerate the async path's brief inconsistency window.

::: warning The synthetic entity is read-only — never update or delete it directly
Once materialized, the entity is a **projection** of the mutual, not an independent record. Never call `updateEntity`, `deleteEntity`, or any other direct entity API on it — always [update or delete the mutual](#querying-mutuals-react) instead.

Updating or deleting the mutual automatically propagates to the synthetic entity — this isn't something `asEntity` implements itself, it rides on the same DynamoDB Streams [replication mechanism](/architecture#data-layout-cheat-sheet) (`R1PK`/`R2PK`) that already keeps denormalized entity data in sync elsewhere in this codebase. Like that existing direction, propagation is asynchronous and eventually consistent — expect a brief delay between updating the mutual and seeing the change on the entity.

Deleting a mutual is handled the same way, promptly — not left to wait for `deleteMutual`'s underlying soft-delete (`expiresAt`) to eventually be swept by DynamoDB's own TTL process, which can otherwise lag by up to ~48 hours. The replication processor detects the soft-delete the moment it happens and removes the synthetic entity (and its tags) right away, on the same short delay as any other update.
:::

Because the whole point of `asEntity` is indexed lookup, pair it with [`tags`](/concepts/tags) on the materialized entity's own `createEntityConfig` — that's what turns "all enrollments" into "all enrollments with role `auditor`, sorted by enrollment date" in O(1).

## Data layout

| Pattern | Key structure |
|---------|---------------|
| Mutual record | `MUTUAL#<id>` primary item |
| Directional lookup | `byEntity -> entity` and the reverse |
