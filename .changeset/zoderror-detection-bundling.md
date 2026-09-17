---
'@monorise/core': patch
'monorise': patch
---

Fix: validation errors now return `400` instead of `500` in a bundled deployment.

Three controllers detected a `ZodError` with `(err as ZodError).constructor?.name === 'ZodError'` — `execute-transaction`, `create-entity` and `update-entity`. A bundler renames the class (observed as `_ZodError` in a deployed Lambda bundle), so the check never matched and every service-level validation error fell through to the generic `500` handler.

This only reproduces in a bundled build. Unbundled source keeps the original class name, so local runs and unit tests pass either way — which is why it went unnoticed.

Now checks `(err as ZodError)?.name === 'ZodError'`. zod sets `name` as an instance property, so it survives bundling, and it is also robust to more than one copy of zod being present (where `instanceof` would not be).
