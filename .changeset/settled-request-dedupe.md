---
"@monorise/react": patch
"monorise": patch
---

Stop handing a settled request back to the next caller with the same request key.

`makeRequest` shares an in-flight request with any caller using the same key, which is right while the request is in flight (a double-clicked Save sends once). But the entry was only removed by `endLoading`, 500 ms after the request settled. A retry within that window got the failed request's rejected promise back, so the retry was never sent: a user pressing Try again straight after a network error saw it fail again.

Now `startLoading` drops a request from `ongoingRequests` as soon as it settles, checked by identity so a newer request under the same key is never removed. `endLoading` keeps its 500 ms delay for the loading indicator only, and no longer touches request dedupe; its `skipDedupe` option is deprecated and ignored.
