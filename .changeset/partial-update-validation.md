---
'@monorise/core': minor
'monorise': minor
---

Fix: `updateEntity` now validates its payload as a partial, so a partial update is no longer rejected for fields it isn't touching.

Both update paths — `EntityService.updateEntity` (`PATCH /entity/:entityType/:entityId`, i.e. the client's `editEntity`/`updateEntity`) and `TransactionService`'s `updateEntity` operation (`POST /transaction`) — validated the submitted payload against the entity's full `mutualSchema`, and `EntityService.updateEntity` additionally validated it against the un-partialed `baseSchema`. A patch that changed a couple of ordinary fields came back `400 API_VALIDATION_ERROR` with a `Required` error for every mutual field the update never mentioned:

```
POST /transaction
{"operations":[
  {"operation":"updateEntity","entityType":"parent","entityId":"…",
   "payload":{"state":{…},"status":"IN_PROGRESS","tallyA":0,"tallyB":0}}]}

400 {"code":"API_VALIDATION_ERROR","message":"Validation failed",
 "details":{"fieldErrors":{"ownerIds":["Required"],"regionIds":["Required"],
   "catalogIds":["Required"],"members":["Required"]}}}
```

This contradicted the declared types on both paths (`payload: Partial<EntitySchemaMap[T]>`), and it contradicted the transaction path's own handling of `baseSchema`, which was already `.partial()`ed. The only way through was for the caller to re-read every existing relationship and re-send it on every unrelated edit.

Both update paths now derive their schemas through a shared `toPartialUpdateSchema` helper (cached per source schema). The change is deliberately narrow:

- **Shallow, not deep.** A field the caller *did* send must still satisfy its full declared shape — a wrong type, a bad enum value, or a half-built nested object is still a 400. Only *absence* is forgiven.
- **Create paths are untouched.** `createEntity`, `collectCreateEvents`, `afterCreateEntityHook`, `finalSchema` and `UpsertEntityController`'s insert case keep parsing against the strict `createSchema` / `createMutualSchema` / `effectiveMutualSchema`. `createMutualSchema` keeps working exactly as before — it just no longer has to be paired with a hand-written `.partial()` on `mutualSchema` to avoid breaking updates.
- **`upsertEntity` is untouched — but NOT because `PUT` is replace-semantics.** On the existing-entity branch it builds the same field-level `SET #data.#<key>` expression `updateEntity` uses, guarded by `attribute_exists(PK)`, so a `PUT` against an existing entity already merges; a key the caller omits is a key the write never mentions. The real blocker is that `UpsertEntityController`'s mutual loop has no `if (!mutualPayload) continue` guard (unlike the update path), so a partialed `mutualSchema` there would publish `ENTITY_MUTUAL_TO_UPDATE` with `mutualIds: undefined` for every relationship the caller never mentioned. Fixing that is larger than this change. **Known consequence:** until it is fixed, the same payload gets 200 on `PATCH` and `POST /transaction` but still 400 on `PUT` for an entity that already exists.
- **`adjustEntity` is untouched.** It never ran a schema parse; it validates finite numbers only.

Mostly permissive, but **not entirely** — two behaviour changes to check before upgrading. Both apply even to configs already authored `.partial()` (the previously documented convention), so "I followed the convention" is not on its own a reason to skip this section.

- **A patch with no recognised base OR mutual field is now `400`, where it used to be a `200` no-op.** `{}` and `{ typoedFieldName: 1 }` previously reached the repository, wrote nothing to `data`, still bumped `updatedAt` and still published `entity-updated`. They are now rejected. This is deliberate — a mistyped field name silently reporting success is worse than an error — but it is a rejection of input that used to be accepted. If you rely on `PATCH {}` as a "touch" to bump `updatedAt`, that call now fails.
- **A top-level `.default()` on `baseSchema` is no longer injected into an update payload.** An update can no longer silently reset a field the caller never mentioned back to its create-time default (e.g. an unrelated edit resetting a stored `COMPLETE` status back to `PENDING`).

Everything else is purely permissive: payloads that were accepted before are still accepted, and the fix only stops rejecting patches for fields they never touched.
