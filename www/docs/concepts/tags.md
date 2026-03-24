# Tags

A **tag** is a key-value pair used to label and classify entities. Tags offer a flexible way to attach descriptive context — like status, type, region, or priority — and can be structured to support **sorting and filtering**.

## Key characteristics

- Tags are attached to a **single type of entity**
- Each tag consists of a **key** and a **value**
- An entity can have **multiple tags** across different dimensions
- Tags can be queried by **key, value, or both**
- Structured tags (e.g., `priority#high`, `createdAt#2025-04-24`) can be **sorted** or used in range queries

## Example

Imagine an **organization** entity with the following tags:

| Group | Sort Value | Use case |
|-------|-----------|----------|
| `region#eu-west-1` | `activatedAt#2025-05-01` | Filter by region + activation date |
| *(empty)* | `activatedAt#2025-05-01` | Range query on activation date |
| `status#active` | *(empty)* | Filter by status |

These tags allow you to:

- Retrieve organizations in a specific region, filtered by activation date
- Retrieve all organizations based on a range of activation dates (regardless of region or status)
- Retrieve organizations by their activation status

## Defining tags

Tags are configured in your entity config:

```ts
const config = createEntityConfig({
  name: 'organisation',
  displayName: 'Organisation',
  baseSchema,
  tags: [
    {
      name: 'type',
      processor: (entity) => {
        return [{ group: entity.data.type }];
      },
    },
    {
      name: 'country',
      processor: (entity) => {
        return [{ group: entity.data.country }];
      },
    },
  ],
});
```

The `processor` function is called whenever an entity is created or updated. It returns an array of tag entries, each with an optional `group` and/or `sortValue`.

## Data layout

| Pattern | Key structure |
|---------|---------------|
| Tag record | `PK = TAG#<entityType>#<tagName>[#group]`, `SK = <sortValue?>#<entityType>#<entityId>` |
| Reverse lookup | By entity for cleanup/updates |
