---
'@monorise/core': patch
'monorise': patch
---

Fix: validation errors now return `400` instead of `500` in a bundled deployment.

Three controllers detected a `ZodError` with `(err as ZodError).constructor?.name === 'ZodError'` — `execute-transaction`, `create-entity` and `update-entity`. A bundler renames the class (observed as `_ZodError` in a deployed Lambda bundle), so the check never matched and every service-level validation error fell through to the generic `500` handler.

This only reproduces in a bundled build. Unbundled source keeps the original class name, so local runs and unit tests pass either way — which is why it went unnoticed.

Now checks `(err as ZodError)?.name === 'ZodError'`. zod sets `name` as an own instance property in its constructor, so it survives identifier renaming — under `--minify` the class becomes something like `r`, while `name` stays `'ZodError'`.

The three sites that detect with `instanceof ZodError` (`upsert-entity`, `create-mutual`, `update-mutual`) are deliberately unchanged: the imported binding and the thrown class are renamed together, so identity still holds under bundling. Only `constructor.name` was broken.
