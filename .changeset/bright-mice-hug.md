---
'@monorise/react': patch
'monorise': patch
---

Keep the React transactional builder browser-safe.

- `@monorise/react` no longer re-exports `transactional` from `@monorise/core`,
  so browser bundles no longer pull in server-only Core code (AWS SDK, `fs`,
  `async_hooks`). React exposes its own builder with the same wire format.
- The unified `monorise` root no longer exports `transactional` (the name is
  ambiguous between the Core and React copies). Use `monorise/core` on the
  server or `monorise/react` in the browser instead. All other root exports
  are unchanged.
