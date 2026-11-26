---
"@monorise/cli": patch
"monorise": patch
---

`monorise init` points the `#/monorise` alias at `.monorise/config.ts` instead of `.monorise/index.ts`. With Vite 8 (Rolldown), importing `index.ts` named a shared client chunk `.monorise-<hash>.js`, which static servers that skip dot-files answered with 404. Existing projects can make the same one-line change; see the FAQ.
