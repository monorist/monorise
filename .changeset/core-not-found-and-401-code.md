---
"@monorise/core": minor
"@monorise/sst": minor
"monorise": minor
---

Core's errors all answer JSON with a `code`:

- An unknown path answers 404 `{ code: 'NOT_FOUND' }` instead of 500. Core's error handler ran as the last middleware, so a path with no route never reached Hono's not-found handler.
- An unexpected error answers 500 `{ code: 'INTERNAL_SERVER_EXCEPTION', id }`, and is logged with that `id`. The error handler now runs as Hono's error handler; as a middleware it never saw thrown errors, which got a plain-text "Internal Server Error".
- A missing or unknown API key answers 401 `{ code: 'UNAUTHORIZED', message: 'Missing or unknown API key' }`, matching the proxy's 401, instead of `{ status, message }` with a generic message. The analytics query API answers the same.

Core no longer defines the `endpoint-error` event (`EVENT.GENERAL.ENDPOINT_ERROR`). Its handler never ran, so the event was never published.
