---
"@monorise/core": patch
"monorise": patch
---

Core's `[MONORISE_DEBUG]` traces of mutual reads and writes, some of which printed mutual payloads, now log only when the `MONORISE_DEBUG` environment variable is set. Internal server errors are still always logged.
