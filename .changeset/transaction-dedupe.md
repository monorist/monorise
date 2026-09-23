---
"@monorise/react": patch
"monorise": patch
---

Stop `executeTransaction` from de-duplicating its HTTP call by operation shape.

`getTransactionCallRequestKey` derived the request key from the operations alone, and `makeRequest` hands any caller with a matching key the in-flight promise instead of issuing a second request. That is correct for idempotent reads, and for a double-clicked Save. It is wrong for a transaction, which is a batch of non-idempotent writes: two structurally identical batches issued close together share a key, so the second caller awaits the first call's promise, is told it succeeded, and its operations are never sent.

Concretely, a UI recording three scores — each a `createEntity(event) + adjustEntity(score, <id>)` pair, so every batch has the identical shape — ended up with one.

**This is a behaviour change.** If you were relying on the previous collapse to absorb rapid duplicate submissions, that no longer happens implicitly; pass an explicit `opts.requestKey` to opt back in.
