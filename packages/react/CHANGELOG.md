# @monorise/react

## 0.2.2

### Patch Changes

- 087ae9d: code refactor:

  - refactor lastKey in core/data to receive and return as string, so users no need to wrap fromLastKeyQuery or toLastKeyResponse again
  - delete local mutual entities in deleteEntity function
  - add & expose helper function of getting requestKey, so users no need check back source code for create/edit/delete entity/mutual functions
  - added StandardErrorCode enum to organize all StandardError.code in framework

## 0.2.1

### Patch Changes

- 7fc2cf9: Update

  - chore: add `npm run dev` to ease development locally
  - feat: support more list tag query params
  - fix: potential undefined state
  - fix: unhandled message in processor/create-entity

## 0.2.0

### Minor Changes

- d9c74bf: Introduce useEntityByUniqueField hook

### Patch Changes

- Updated dependencies [47957b2]
  - @monorise/base@0.0.4

## 0.1.2

### Patch Changes

- f0c7994: fix file delete endpoint

## 0.1.1

### Patch Changes

- 6867c27: fix axios interceptor removing all headers

## 0.1.0

### Minor Changes

- ea9d13f: file upload service disable loading and pass filetype

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
