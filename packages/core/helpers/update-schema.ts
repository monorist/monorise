import type { z } from 'zod';

/**
 * Cache keyed on the *source* schema object. Entity configs are built once at
 * module-evaluation time (`createEntityConfig`), so each source schema is a
 * stable identity for the process lifetime and this resolves to one derived
 * ZodObject per schema rather than rebuilding one per request. WeakMap (not
 * Map) so a config discarded by a test suite can still be collected.
 */
const partialCache = new WeakMap<object, z.AnyZodObject>();

// Keyed on the schema object so the warning below fires once per offending
// config rather than once per request. WeakMap-backed for the same reason
// partialCache is: a schema that goes out of scope shouldn't be retained.
const warnedNonPartialable = new WeakSet<object>();

/**
 * @description The update-path counterpart of a create-path schema: every
 * TOP-LEVEL key becomes optional, nothing else changes.
 *
 * An update writes a field-level DynamoDB SET expression — it touches only the
 * keys the caller actually sent — so the thing being validated is a patch, not
 * a whole entity. Validating a patch against the create-time schema reports
 * every untouched field as `Required`, which is why both
 * `EntityService.updateEntity` and `TransactionService`'s update path route
 * their schemas through here. The create paths (`createEntity`,
 * `collectCreateEvents`, `afterCreateEntityHook`, `finalSchema`, and
 * `UpsertEntityController`'s insert case) deliberately do NOT use this — a
 * create/replace really does receive the whole entity, so `createSchema` /
 * `createMutualSchema` stay strict there.
 *
 * Shallow on purpose (`.partial()`, not `.deepPartial()`): a field the caller
 * DID send must still satisfy its full declared shape. Sending
 * `{ clock: { period: 'Q1' } }` for a `clock` that also requires `time` is a
 * malformed patch and still fails, exactly as it should — only *absence* is
 * forgiven, never a wrong or half-built value.
 *
 * Note this also means a `.default()` on a top-level key stops being injected
 * into updates (zod short-circuits `ZodOptional` on a missing key before the
 * inner `ZodDefault` runs). That is the intended reading: a create-time default
 * has no business silently reappearing in a patch and clobbering the stored
 * value of a field the caller never mentioned.
 */
export const toPartialUpdateSchema = <T extends z.AnyZodObject>(
  schema: T,
): z.AnyZodObject => {
  const cached = partialCache.get(schema);
  if (cached) return cached;

  // `mutualSchema`/`baseSchema` are typed as ZodObject, so this is unreachable
  // through `createEntityConfig` — only an `any`-cast (test fixtures, configs
  // built by hand) can get here with something that has no `.partial()`.
  //
  // Falling back to the strict schema is still the right failure mode — better
  // than a TypeError that reads as an unrelated crash — but it must not be
  // SILENT: a config that lands here keeps exactly the bug this helper exists
  // to fix, and nothing downstream would ever say so. Warn once per schema.
  if (typeof (schema as { partial?: unknown }).partial !== 'function') {
    if (!warnedNonPartialable.has(schema)) {
      warnedNonPartialable.add(schema);
      console.warn(
        '[monorise] toPartialUpdateSchema received a schema with no .partial() ' +
          '(likely a refined/effected schema, or a config built outside ' +
          'createEntityConfig). Falling back to strict validation, so partial ' +
          'updates against it will still be rejected for fields they do not touch.',
      );
    }
    return schema;
  }

  const partial = schema.partial();
  partialCache.set(schema, partial);
  return partial;
};
