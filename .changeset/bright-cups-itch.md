---
"@monorise/core": minor
---

Add conditional `$where` support to core entity PATCH updates so callers can apply atomic compare-and-set style updates with DynamoDB condition expressions.

Map failed conditional checks to `CONDITIONAL_CHECK_FAILED` and return HTTP 409 from the update entity controller.
