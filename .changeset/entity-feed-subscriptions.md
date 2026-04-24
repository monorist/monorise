---
"@monorise/core": minor
---

Add feed subscription broadcast resolution via mutual graph traversal.

- `broadcastToFeedSubscribers()` resolves affected feed subscribers when changes occur
- Traverses mutual relationships to find connected entities with feed subscriptions
- Filters by feedTypes whitelist, deduplicates per-connection
- ConsistentRead on all broadcast subscriber queries
- Broadcast always runs feed resolution (not skipped when no direct subscribers)
- $disconnect cleans up all subscription records via R1 GSI
