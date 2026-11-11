---
"@monorise/proxy": minor
"@monorise/cli": minor
"monorise": minor
---

Add `createProxyHandler` to `monorise/proxy`: your app's server route in front of Monorise Core, in one file.

- **Per-user rules:** each request is described as operations (entity get, list, create, update, adjust and delete; relationship read and writes, including relationship fields, the entities `asEntity` creates and every transaction entry; custom routes) and checked against rules before it reaches Core. An adjust is its own action, so a rule written for update values never approves one. Rules are strict by default, with `'*'` fallbacks and `allow`/`deny` helpers; `rules: { '*': allow }` lets the key alone decide.
- **Several kinds of caller:** `authenticate` reads the session, `caller` picks an entry in `callers`, and each entry has its own API key, rules and custom-route rules.
- **Safe forwarding:** only `content-type`, `accept`, `accept-language` and `x-request-id` are forwarded, with the caller's `x-api-key`; cookies, `authorization` and client-sent keys never reach Core. Core's response passes through unchanged.
- **Any framework:** `handle(request)` takes a web-standard `Request`, with `GET` to `DELETE` aliases for Next.js. `checkRequest(request)` runs every step but forwarding, for testing rules.
- **Typed:** rule tables, operations and payloads are typed from the generated `Entity`, `EntitySchemaMap` and `mutualData` names.

`monorise init` now generates `app/api/core/[...path]/route.ts` with `createProxyHandler`, plus a WebSocket ticket route, instead of `proxy-request.ts` and `[...proxy]/route.ts`. Existing projects keep their files; see the [Proxy](https://monorise.dev/proxy) guide to move.
