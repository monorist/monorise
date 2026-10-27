---
'@monorise/react': minor
'monorise': minor
---

Add mutation hooks for entity, mutual, and transaction writes.

Each hook binds its mutation target and exposes `mutate`, `isLoading`, `error`,
`clearError`, and `requestKey`. State is shared with matching direct actions and
transaction operations, so components no longer need to derive keys and call
`useLoadStore` or `useErrorStore` themselves.

All writes now receive a unique HTTP request key by default. This prevents
concurrent creates, edits, adjustments, deletes, and mutual writes to the same
target from being implicitly deduplicated. Pass the same explicit
`opts.requestKey` to intentionally share an in-flight write.

The stable `createMutual` loading/error key now includes the target `entityId`,
so separate links from the same source no longer share mutation state. Code
that manually calls `getMutualRequestKey('create', ...)` should pass the target
ID as its fifth argument.
