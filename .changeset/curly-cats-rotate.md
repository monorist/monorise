---
'@monorise/cli': patch
'@monorise/sst': patch
'monorise': patch
---

Create and expose an `X_API_KEY` secret from `MonoriseCore`, and generate backend proxies that link the selected key instead of embedding it in the Next.js environment.
