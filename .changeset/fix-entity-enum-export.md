---
"@monorise/base": patch
"monorise": patch
---

Fix Entity enum `declare module` augmentation by restoring `export` on the enum declaration in bundled `.d.ts` output. The tsup DTS bundler was stripping `export` from `export declare enum Entity {}`, which broke TypeScript module augmentation for consumer projects.
