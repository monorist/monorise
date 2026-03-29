---
"@monorise/base": minor
"@monorise/core": minor
"@monorise/react": minor
"monorise": minor
---

Add adjustEntity for atomic numeric updates on entity fields. Uses DynamoDB's native arithmetic expressions (SET field = field + delta) for race-condition-free concurrent writes. Useful for counters, accumulators, and real-time metrics.
