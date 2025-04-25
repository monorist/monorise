# @monorise/react

## 0.0.6

### Patch Changes

- Updated dependencies [06e2048]
  - @monorise/base@0.0.3

## 0.0.5

### Patch Changes

- 59d3bcb: fix mutual state key

## 0.0.4

### Patch Changes

- 9c122b7: feat(react): add onProgress to uploadFile
- 6f5ce33: - expose `TagRepository` type
  - `listEntitiesByEntity`: added `'#'` at the end of `SK` value to prevent accidentally got unwanted entity (eg.: desire to get `company` entity but returned both `company` & `company-staff` entities)
  - `editEntity`: update local mutual state to latest entity data
  - `useEntities`: expose `lastKey` & `isFirstFetched` attribute
  - `useMutuals`: expose `lastKey` attribute and added `listMore` function

## 0.0.3

### Patch Changes

- d8bbd51: bump without changes

## 0.0.2

### Patch Changes

- 83579b5: update monorise/base as peer dependency
- 83579b5: expose attributes and add options to useEntity & useMutuals hook
- c79f845: bump react
- 83579b5: fix: clashed statekey when useMutuals with chainEntityQuery
- 83579b5: Amend editMutual method to use PATCH method
- 83579b5: add createLocalMutual action
- 83579b5: added useTaggedEntities hook
- 83579b5: fix axios request config typing
- Updated dependencies [83579b5]
- Updated dependencies [83579b5]
- Updated dependencies [83579b5]
- Updated dependencies [83579b5]
  - @monorise/base@0.0.2

## 0.0.2

### Patch Changes

- 3517300: fix: clashed statekey when useMutuals with chainEntityQuery

## 0.0.1

### Patch Changes

- d228c47: setup changesets
- Updated dependencies [d228c47]
  - @monorise/base@0.0.1

## 0.0.1-dev.0

### Patch Changes

- d228c47: setup changesets
- Updated dependencies [d228c47]
  - @monorise/base@0.0.1-dev.0
