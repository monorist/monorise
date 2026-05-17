---
"@monorise/core": patch
"monorise": patch
---

fix(mutual): improve error handling for mutual endpoints

- Fix ZodError detection to use duck typing instead of `instanceof` (prevents false negatives when consumer has different zod instance)
- Catch all StandardErrors in mutual controllers and return as 400 Bad Request
- Add catch-all error handler to prevent unhandled 500s with cryptic messages
- Fix general error handler to safely log error properties without crashing on AWS SDK error objects
