---
"@monorise/base": major
"@monorise/cli": major
"@monorise/core": major
"@monorise/proxy": major
"@monorise/react": major
"@monorise/sst": major
"monorise": major
---

Upgrade to SST v4

- Bumped `sst` peer dependency from `^3.16.3` to `^4.0.0`
- Aligned all `@monorise/*` packages to version `4.0.0`
- Bumped unified `monorise` package to version `1.0.0`
- Fixed internal type leak in `QFunction` that referenced `.sst/platform` paths
- Updated `examples/basic` and `examples/websocket-chat` to use SST v4 and Monorise v1
- Added migration guide at `docs/MIGRATE-SST-V4.md`
