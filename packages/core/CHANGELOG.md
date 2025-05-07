# @monorise/core

## 0.1.3

### Patch Changes

- f23b09e: Change core package transpile target

## 0.1.2

### Patch Changes

- 992399f: fix @monorise/core export issue

## 0.1.1

### Patch Changes

- 68eac73: fix: @monorise/core export issue

## 0.1.0

### Minor Changes

- 47957b2: Introduce unique fields

### Patch Changes

- eccbfbd: - test cases for Mutual and Mutual Repository
  - fix get deleted Mutual still exists
  - refactored test helpers

## 0.0.4

### Patch Changes

- Updated dependencies [06e2048]
  - @monorise/base@0.0.3

## 0.0.3

### Patch Changes

- f95a5ed: \* chore(core): add tests for Entity and EntityRepository
  - fix(core): upsertEntity `updatedAt` not updated to latest time

## 0.0.2

### Patch Changes

- 6f5ce33: - expose `TagRepository` type
  - `listEntitiesByEntity`: added `'#'` at the end of `SK` value to prevent accidentally got unwanted entity (eg.: desire to get `company` entity but returned both `company` & `company-staff` entities)
  - `editEntity`: update local mutual state to latest entity data
  - `useEntities`: expose `lastKey` & `isFirstFetched` attribute
  - `useMutuals`: expose `lastKey` attribute and added `listMore` function

## 0.0.1

### Patch Changes

- 83579b5: update monorise/base as peer dependency
- 83579b5: Introduce core package
- 83579b5: update mock import
- 83579b5: Amend editMutual method to use PATCH method
- 83579b5: export data repository and service
- Updated dependencies [83579b5]
- Updated dependencies [83579b5]
- Updated dependencies [83579b5]
- Updated dependencies [83579b5]
  - @monorise/base@0.0.2

## 0.0.1-dev.4

### Patch Changes

- e48ed2e: Amend editMutual method to use PATCH method

## 0.0.1-dev.3

### Patch Changes

- b222348: export data repository and service
- Updated dependencies [b222348]
  - @monorise/base@0.0.2-dev.2

## 0.0.1-dev.2

### Patch Changes

- a2d3dab: update monorise/base as peer dependency

## 0.0.1-dev.1

### Patch Changes

- 9200378: update mock import

## 0.0.1-dev.0

### Patch Changes

- 4de00a9: Introduce core package
