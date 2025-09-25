# @monorise/core

## 0.1.13

### Patch Changes

- 2181e0a: fix unique field missing updatedAt timestamp

## 0.1.12

### Patch Changes

- dfdf262: fix tag processor race condition

## 0.1.11

### Patch Changes

- a6ce58a: unique field validation bug fix

## 0.1.10

### Patch Changes

- 5eafbba: feat: support limit mutuals returned

## 0.1.9

### Patch Changes

- 9ceb344: list mutuals and entities projection expression accepts any string.

## 0.1.8

### Patch Changes

- c134108: chore: expose MutualService class

## 0.1.7

### Patch Changes

- 087ae9d: code refactor:

  - refactor lastKey in core/data to receive and return as string, so users no need to wrap fromLastKeyQuery or toLastKeyResponse again
  - delete local mutual entities in deleteEntity function
  - add & expose helper function of getting requestKey, so users no need check back source code for create/edit/delete entity/mutual functions
  - added StandardErrorCode enum to organize all StandardError.code in framework

## 0.1.6

### Patch Changes

- 7fc2cf9: Update

  - chore: add `npm run dev` to ease development locally
  - feat: support more list tag query params
  - fix: potential undefined state
  - fix: unhandled message in processor/create-entity

## 0.1.5

### Patch Changes

- 84679d3: handle unique field transaction error

## 0.1.4

### Patch Changes

- edcc3e9: fix tsconfig exclude path to relative

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
