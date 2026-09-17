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

Without `createMutualSchema`, a create can silently omit a required link — the entity is created, but never wired to the relationship, with no error anywhere. That is the problem this solves.

It costs you nothing on the update path: updates are validated against a partial derived from `mutualSchema` by the SDK, so making a field required here never forces an unrelated patch to resend it.

`createMutualSchema` is an optional, stricter sibling of `mutualSchema` that's validated **only on create**. When present, its shape is merged into `mutualSchema` for the create payload — so any mutual field `mutualSchema` declares but `createMutualSchema` doesn't repeat is still validated and wired, and `createMutualSchema` only needs to list the field(s) it's tightening. `mutualSchema` itself keeps validating updates, as a derived partial.

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
});
```

`mutualDataSchema` must be **omitted** when `asEntity` is set — it's derived automatically from `asEntity.finalSchema` (that entity's own `baseSchema` + `createSchema` + `effectiveMutualSchema`, merged, same as any normal `createEntity` payload validates against). Providing both `asEntity` and `mutualDataSchema` on the same config is a build-time and runtime error, so the mutual's data shape can never drift from the materialized entity's own shape.

When `asEntity` is set, creating the mutual also creates a real `Entity`: `entityType = asEntity.name`, `entityId = <the mutual's own generated ulid>`, `data = <the mutual's own parsed mutualData>`.

That entity is written in the **same DynamoDB transaction** as the mutual itself, and its `afterCreateEntityHook` (tags/mutualFields wiring) fires immediately after the commit. Either both records land or neither does, so a business flow can read the materialized entity the moment `createMutual` returns — an immediate redirect to `GET /entity/enrollment/:id` is safe — and there is never a committed mutual whose projection is missing.

The cost is honest but real: a `TransactWriteItems` consumes **2x the write capacity** of a plain write and adds some latency. The transaction stays small regardless of how many relationships you're wiring — the declarative `mutualFields` processor issues one transaction per mutual, so it's roughly 5 items against DynamoDB's 100-item transaction limit, not one giant transaction for the whole array. That extra WCU buys a projection that cannot silently diverge from the edge it projects.

::: warning The synthetic entity is read-only — never update or delete it directly
Once materialized, the entity is a **projection** of the mutual, not an independent record. Never call `updateEntity`, `deleteEntity`, or any other direct entity API on it — always [update or delete the mutual](#querying-mutuals-react) instead.

Changes to the mutual propagate to the synthetic entity on their own — this isn't something `asEntity` implements itself, it rides on the same DynamoDB Streams [replication mechanism](/architecture#data-layout-cheat-sheet) (`R1PK`/`R2PK`) that already keeps denormalized entity data in sync elsewhere in this codebase. **Updates and deletes propagate on very different timescales, though:**

- **Updates** — `updateMutual` writes new `mutualData`, the stream's `MODIFY` record fires, and replication copies it onto the entity. Asynchronous and eventually consistent, but prompt: expect a delay on the order of seconds.
- **Deletes** — `deleteMutual` is a **soft delete**. It sets `expiresAt` on the mutual (also a `MODIFY`, which replication treats as a data update, not a removal). The synthetic entity is only removed once DynamoDB's TTL sweep physically deletes the mutual item and emits a `REMOVE` record. **AWS gives no timing guarantee for that sweep — it typically happens within 48 hours of expiry, not immediately.** Until then the synthetic entity remains fully readable: `getEntity`, `queryEntities`, and `tags` lookups all still return it.

That delete lag is not specific to `asEntity` — no entity read path in this codebase filters on `expiresAt`, so the [general entity TTL](/concepts/entities#ttl-time-to-live) feature behaves identically. But it matters more here, because indexed `tags` lookups are the reason to reach for `asEntity` in the first place. **If your reads must not see deleted relationships, don't rely on the entity disappearing** — either filter the results against the mutual side (`listEntitiesByEntity` and the mutual write guards *do* gate on `attribute_not_exists(expiresAt)`, so the mutual reads as gone immediately), or carry an explicit status field in the entity's own `data` and filter on that.
:::

Because the whole point of `asEntity` is indexed lookup, pair it with [`tags`](/concepts/tags) on the materialized entity's own `createEntityConfig` — that's what turns "all enrollments" into "all enrollments with role `auditor`, sorted by enrollment date" in O(1).

## Data layout

| Pattern | Key structure |
|---------|---------------|
| Mutual record | `MUTUAL#<id>` primary item |
| Directional lookup | `byEntity -> entity` and the reverse |
