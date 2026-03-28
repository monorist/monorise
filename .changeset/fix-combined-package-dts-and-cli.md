---
"@monorise/cli": patch
"monorise": patch
---

Fix combined package DTS rewriting and CLI monorepo detection

- build.js: Fix regex that missed rewriting some `@monorise/*` imports in `.d.ts` files (global regex `lastIndex` bug + missing double-quote patterns)
- cli: Add `detectCombinedPackage()` that walks up directory tree for monorepo hoisting support, and generate correct module augmentation based on detection
