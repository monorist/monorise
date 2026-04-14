# @monorise/cli

## 4.0.0

### Major Changes

- e6a935f: Upgrade to SST v4

  - Bumped `sst` peer dependency from `^3.16.3` to `4.7.3`
  - Fixed internal type leak in `QFunction` that referenced `.sst/platform` paths
  - Updated `examples/basic` to use SST v4 and the unified `monorise` package
  - Added migration guide at `docs/MIGRATE-SST-V4.md`

## 3.0.3

### Patch Changes

- b59075f: Fix combined package DTS rewriting and CLI monorepo detection

  - build.js: Fix regex that missed rewriting some `@monorise/*` imports in `.d.ts` files (global regex `lastIndex` bug + missing double-quote patterns)
  - cli: Add `detectCombinedPackage()` that walks up directory tree for monorepo hoisting support, and generate correct module augmentation based on detection

## 3.0.3-dev.0

### Patch Changes

- b59075f: Fix combined package DTS rewriting and CLI monorepo detection

  - build.js: Fix regex that missed rewriting some `@monorise/*` imports in `.d.ts` files (global regex `lastIndex` bug + missing double-quote patterns)
  - cli: Add `detectCombinedPackage()` that walks up directory tree for monorepo hoisting support, and generate correct module augmentation based on detection

## 3.0.2

### Patch Changes

- 7a29b6a: Add module augmentation for monorise/base combined package to fix type resolution
- 7a29b6a: include handle @

## 3.0.2-dev.1

### Patch Changes

- 37193cc: include handle @

## 3.0.2-dev.0

### Patch Changes

- eeb410d: Add module augmentation for monorise/base combined package to fix type resolution

## 3.0.1

### Patch Changes

- 5e8d320: Unified monorise package

## 3.0.0

### Major Changes

- 70c31c7: Bump to v3

## 2.0.0

### Major Changes

- Bump version

## 1.0.0

### Major Changes

- Release v3.0.0 - Major stable release
- 54beb03: monorise to support sst v3

### Patch Changes

- 9c0dcaf: fix: Provide a default typing for EmailAuthEnabledEntities
- a83462f: update:

  - sst: support `configRoot`
  - sst: piggyback fix tsconfig.json indefinite loop when build
  - sst: comment out unused send alarm handler
  - cli: support `--config-root`
  - cli: piggyback fix tsconfig.json indefinite loop when build

- b642115: fix: monorise.config.ts read path inconsistency
  chore: help manual update to --config-root
- c3609ab: feat: dependency container access from custom route

## 1.0.0-dev.3

### Patch Changes

- 9c0dcaf: fix: Provide a default typing for EmailAuthEnabledEntities

## 1.0.0-dev.2

### Patch Changes

- b642115: fix: monorise.config.ts read path inconsistency
  chore: help manual update to --config-root
- c3609ab: feat: dependency container access from custom route

## 1.0.0-dev.1

### Patch Changes

- a83462f: update:

  - sst: support `configRoot`
  - sst: piggyback fix tsconfig.json indefinite loop when build
  - sst: comment out unused send alarm handler
  - cli: support `--config-root`
  - cli: piggyback fix tsconfig.json indefinite loop when build

## 1.0.0-dev.0

### Major Changes

- 54beb03: monorise to support sst v3

## 0.1.0

### Minor Changes

- c9bbbd9: add cli dev mode

## 0.0.2

### Patch Changes

- 83579b5: Remove export of createEntityConfig
- 83579b5: monorise cli generate an export default config object
- 83579b5: EntitySchemaMap should be using Entity enum as key

## 0.0.2-dev.2

### Patch Changes

- c8c3a45: EntitySchemaMap should be using Entity enum as key

## 0.0.2-dev.1

### Patch Changes

- 9200378: Remove export of createEntityConfig

## 0.0.2-dev.0

### Patch Changes

- 0e87cb0: monorise cli generate an export default config object

## 0.0.1

### Patch Changes

- d228c47: setup changesets

## 0.0.1-dev.0

### Patch Changes

- d228c47: setup changesets
