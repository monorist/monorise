---
"@monorise/base": minor
"@monorise/core": minor
"monorise": minor
---

Add `createMutualConfig` for centralized mutualData schema validation. Define a Zod schema once for mutual relationships and reference it from both entity configs. Validates mutualData on create, update, and processor output.
