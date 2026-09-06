---
"@monorise/base": minor
"@monorise/core": minor
"monorise": minor
---

Add optional `createMutualSchema` to an entity's `mutual` config, letting a mutual field be required only at creation time while `mutualSchema` itself stays `.partial()` for updates.

Previously, `mutualSchema` was the single schema validated on both create and update. Making it non-partial to enforce a required mutual field at creation would also force every future *update* to resend that same field, even for edits unrelated to the relationship. Keeping it partial to avoid that meant a create could silently omit a required mutual link — the entity would be created, but never wired to the relationship, with no error anywhere.

`createMutualSchema` closes that gap: when defined, it's used instead of `mutualSchema` on the create path only (`EntityService.createEntity` → `EntityServiceLifeCycle.afterCreateEntityHook`, `TransactionService.buildCreateItems`/`collectCreateEvents`, and `finalSchema`'s construction). The update path (`EntityService.updateEntity`, `TransactionService.buildUpdateItem`/`collectUpdateEvents`) is untouched and always uses the ordinary `mutualSchema`. Fully backward compatible — entities with no `createMutualSchema` behave exactly as before.

```ts
const mutualSchema = z.object({ organisationIds: z.string().array() }).partial();
const createMutualSchema = z.object({ organisationIds: z.string().array() }); // required on create only

const config = createEntityConfig({
  name: 'competition',
  displayName: 'Competition',
  baseSchema,
  createSchema,
  mutual: {
    mutualSchema,
    createMutualSchema,
    mutualFields: {
      organisationIds: { entityType: Entity.ORGANISATION },
    },
  },
});
```
