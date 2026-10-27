---
"@monorise/react": patch
"monorise": patch
---

Return `useMutuals`' `mutuals`, and `useTaggedEntities`' and `useEntities`' `entities`, in the same render as the store's data.

Each hook copied the store's map into its own array state from a `useEffect`, so the array trailed `isFirstFetched` and the `…Map` by one render. On the render where a list finished loading, `isFirstFetched` was already `true` while the array was still `[]`. A page that shows an empty state or "not found" for an empty loaded list rendered and committed that state, then rendered again once the effect had copied the data. React re-renders before the browser paints, so it wasn't visible. But it was a wasted render, and any effect inside that state ran: a redirect on an empty list, for example. That pushed apps to read the map instead.

The arrays are now built from the store's map during render, memoised on the map, which the store replaces on every change. They keep their identity until the data changes, and they never lag the map or `isFirstFetched`. `useEntities` still returns the search results while a query is set, and clearing the query still stops it searching.

`useEntities`' `entities` is now an array from the first render rather than `undefined` until its first effect ran. Use `isFirstFetched` to tell "not loaded yet" from "loaded and empty".
