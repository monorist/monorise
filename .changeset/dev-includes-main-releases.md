---
"@monorise/base": minor
"@monorise/cli": minor
"@monorise/core": patch
"@monorise/react": patch
"@monorise/sst": minor
"monorise": patch
---

The dev pre-releases now include everything released from main up to base 4.8.0 and core 4.11.0: indexed search, warnings instead of failures for removed analytics fields, mutual traces behind `MONORISE_DEBUG`, and the CloudWatch dashboard off by default. API key search checks now cover an entity's indexed `search` fields, not only `searchableFields`. Base, cli and sst stay a minor above main's releases, since dev adds API key policies, the proxy template and the `default` policy placeholder on top of them.
