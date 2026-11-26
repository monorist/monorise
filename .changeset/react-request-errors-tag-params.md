---
"@monorise/react": minor
"monorise": minor
---

- Mutation actions and hooks' `mutate` resolve `{ error }` with a `RequestError`: the same `Error`, now with the server's `status`, `code` and `data` when it answered, so detecting e.g. `409 UNIQUE_VALUE_EXISTS` needs no cast. `RequestError` is exported.
- `useTaggedEntities` waits while any value in `params` is `undefined`, such as a group that comes from data not loaded yet, instead of fetching without it. It also no longer throws when called without `params`.
