---
"@monorise/core": patch
---

Fix tag list endpoint crashing when limit query parameter is not provided. `Number(undefined)` produced `NaN` which caused a DynamoDB SerializationException.
