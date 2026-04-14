---
"@monorise/base": major
"@monorise/cli": major
"@monorise/core": major
"@monorise/sst": major
"monorise": major
---

Upgrade to SST v4

- Bumped `sst` peer dependency from `^3.16.3` to `4.7.3`
- Fixed internal type leak in `QFunction` that referenced `.sst/platform` paths
- Updated `examples/basic` to use SST v4 and the unified `monorise` package
- Added migration guide at `docs/MIGRATE-SST-V4.md`
