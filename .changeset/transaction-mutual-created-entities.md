---
"@monorise/core": patch
"monorise": patch
---

A transactional `createMutual` can link to an entity created by a `createEntity` in the same transaction. It used to read both entities from the table before the commit, so it couldn't find the new one.
