---
"@monorise/base": minor
"@monorise/core": minor
"@monorise/cli": minor
"@monorise/sst": minor
"monorise": minor
---

Add the built-in `default` API key policy: keys you can narrow later without changing them. Keys under `default` in `API_KEYS` can do everything `full` can until the project defines a policy named `default`; from then on they get exactly what it grants. The SST placeholder for `API_KEYS` is now `{"default": ["secret1", "secret2"]}`, and `monorise init` scaffolds `monorise/api-keys.ts` and points `apiKeys` at it. The array form still gives every key `full`, unchanged.
