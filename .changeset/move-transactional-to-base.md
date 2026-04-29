---
'@monorise/base': patch
'@monorise/core': patch
'@monorise/react': patch
'monorise': patch
---

Move transactional helper and transaction types to @monorise/base to prevent React bundling issues. The transactional helper was previously exported from @monorise/core, which caused Next.js builds to bundle Node.js-only AWS SDK modules (fs, async_hooks) when importing from @monorise/react.
