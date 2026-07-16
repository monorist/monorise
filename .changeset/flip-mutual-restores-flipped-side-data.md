---
"@monorise/react": patch
"monorise": patch
---

Fix `flipMutual` so the flipped-side mutual cache entry's `data` describes the correct entity. Previously the flipped record reused the original side's `data`, which made `useMutuals` on the opposite view briefly render the wrong entity's fields after `createMutual`/`editMutual`/`upsertLocalMutual`/`createLocalMutual` — until a refresh refetched that side from the server.
