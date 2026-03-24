# Mutuals

A **mutual** is a relationship between two entities where the relationship itself holds meaningful data. Rather than just linking two entities together, mutuals capture **context** — such as timestamps, roles, or statuses — that lives on the relationship itself.

## Key characteristics

- Represents a **relationship** between two distinct entities
- The relationship itself can **store data** (e.g., roles, timestamps, status)
- Supports querying **from either direction** (e.g., all courses for a student, or all students in a course)
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

> For example, when Student `A` is associated with 5 Courses, you can query by the mutual relationship to list all courses for Student `A`.

## Defining mutuals

Mutuals are configured within an entity's config:

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

## Data layout

| Pattern | Key structure |
|---------|---------------|
| Mutual record | `MUTUAL#<id>` primary item |
| Directional lookup | `byEntity -> entity` and the reverse |
