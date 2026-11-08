---
"@monorise/base": minor
"@monorise/cli": minor
"@monorise/core": minor
"@monorise/sst": minor
"monorise": minor
---

Indexed search: entities can now be searched by word without reading every entity of the type. Set `search` on an entity config instead of `searchableFields`:

```ts
search: {
  fields: [{ field: 'name' }, { field: 'email' }],
},
```

Each field is split into words on spaces and symbols, and each word is stored as a copy of the entity. `?query=john doe` then reads only the copies under its longest word, instead of every entity.

- **Matching.** Plain words match from the start of a word, in any order (`jo do` finds "John Doe"). Quoted text (`"john doe"`) and text joined by symbols (`jane@mail.com`) must also appear exactly. Matching mid-word ("lumbing" in "plumbing") isn't supported.
- **Settings.** `maxWords` (default 8) caps the words indexed per entity, and `ignoreWords` (default `DEFAULT_IGNORE_WORDS`, also known as stop words) lists words that are never indexed. Both can also be set for every entity under `search` in `monorise.config.ts`; an entity's own setting replaces the global one.
- **Cost.** Every update of an entity writes up to `maxWords` extra items, whichever field changed, because the replication processor keeps each copy current.
- **Rollout.** On deploy, a new reindex function builds the index for existing entities whenever an entity's search config changes. Until it finishes, queries on that type scan every entity, with the same results.

**Nothing changes for existing projects.** `searchableFields` keeps scanning every entity as before. It now also handles array and number fields, which used to make every search on the type fail.

`@monorise/core` now uses search helpers from `@monorise/base` at runtime, so upgrade the two together.
