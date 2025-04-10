---
"@monorise/react": patch
"@monorise/core": patch
---

- expose `TagRepository` type
- `listEntitiesByEntity`: added `'#'` at the end of `SK` value to prevent accidentally got unwanted entity (eg.: desire to get `company` entity but returned both `company` & `company-staff` entities)
- `editEntity`: update local mutual state to latest entity data
- `useEntities`: expose `lastKey` & `isFirstFetched` attribute
- `useMutuals`: expose `lastKey` attribute and added `listMore` function
