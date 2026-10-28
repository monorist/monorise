---
"@monorise/react": patch
"monorise": patch
---

Return `useMutuals`' `mutuals`, and `useTaggedEntities`' and `useEntities`' `entities`, in the same render as the store's data.

Each hook copied the store's map into its own array state from a `useEffect`, so the array trailed `isFirstFetched` and the `…Map` by one render. On the render where a list finished loading, `isFirstFetched` was already `true` while the array was still `[]`. A page that shows an empty state or "not found" for an empty loaded list rendered and committed that state, then rendered again once the effect had copied the data. React re-renders before the browser paints, so it wasn't visible. But it was a wasted render, and any effect inside that state ran: a redirect on an empty list, for example. That pushed apps to read the map instead.

The arrays are now built from the store's map during render, memoised on the map, so they never lag the map or `isFirstFetched`. `useEntities` still returns the search results while a query is set, and clearing the query still stops it searching.

Behaviour changes:

- **Array identity now follows the store's map, not the data.** An array keeps its identity until the store replaces its slice's map, which it does on any write to the slice. That includes a refetch or `forceFetch` that returns identical data, a `getEntity` for an entity already listed, a tag list writing the same entities, and a websocket echo. The removed effects compared contents with `JSON.stringify` and kept the old array through those. An effect keyed on one of these arrays, such as one that resets a selection or fires analytics, now runs again after each of them. Key it on what it reads (ids, a count, a field) if that matters.
- **`useEntities`' `entities` is an array from the first render**, rather than `undefined` until its first effect ran. Use `isFirstFetched` to tell "not loaded yet" from "loaded and empty".
