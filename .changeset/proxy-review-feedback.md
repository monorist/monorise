---
"@monorise/proxy": patch
"monorise": patch
---

`createProxyHandler` fixes from early use:

- Every response carries `cache-control: private, no-store` unless Core set its own, so a CDN never serves one user's response, or a cached error, to the next user of the same URL.
- A throw from `authenticate`, `caller` or a rule answers 500 `PROXY_ERROR` naming what threw, and logs the error, instead of escaping `handle()`.
- An `update` or `adjust` that names a condition carries it as `condition`, from `$condition` or a transaction entry's `condition`, so a rule can require one.
- `@monorise/proxy` declares its repository, which npm's provenance check needs: `3.2.0-dev.0` failed to publish without it.
