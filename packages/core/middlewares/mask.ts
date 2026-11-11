import type { ApiKeyFieldAccess, CompiledApiKeyPolicy } from '@monorise/base';
import { createMiddleware } from 'hono/factory';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Keeps only the fields `granted` allows: all for `'*'`, none for `null`. */
export const maskFields = (
  data: Record<string, unknown>,
  granted: ApiKeyFieldAccess | null,
): Record<string, unknown> =>
  granted === '*'
    ? data
    : Object.fromEntries(
        Object.entries(data).filter(([field]) => granted?.has(field)),
      );

/**
 * Masks an entity, tag or relationship record: `data` by its entity type's
 * read grant, and a relationship's `mutualData` by its direction's.
 */
export const maskRecord = (
  record: Record<string, unknown>,
  access: CompiledApiKeyPolicy,
): Record<string, unknown> => {
  const entityType = record.entityType as string;
  const masked = { ...record };
  if (isPlainObject(record.data)) {
    masked.data = maskFields(record.data, access.entity(entityType).read);
  }
  if (
    typeof record.byEntityType === 'string' &&
    isPlainObject(record.mutualData)
  ) {
    masked.mutualData = maskFields(
      record.mutualData,
      access.mutual(record.byEntityType, entityType)?.read ?? null,
    );
  }
  return masked;
};

/**
 * Masks every record in a response body, wherever it sits: a single entity,
 * a list's `data` or `entities`, a transaction's `results`. A record is any
 * object with an `entityType` and `data` or `mutualData`, which every
 * built-in response uses for entities, tags and relationships alike.
 */
export const maskResponseBody = (
  body: unknown,
  access: CompiledApiKeyPolicy,
): unknown => {
  if (Array.isArray(body))
    return body.map((item) => maskResponseBody(item, access));
  if (!isPlainObject(body)) return body;
  if (
    typeof body.entityType === 'string' &&
    ('data' in body || 'mutualData' in body)
  ) {
    return maskRecord(body, access);
  }
  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => [
      key,
      maskResponseBody(value, access),
    ]),
  );
};

/**
 * Masks the JSON a built-in route responds with, after its controller runs,
 * so no field the key cannot read leaves the API. `full` keys, requests
 * without a key, and error responses pass through untouched.
 */
export const maskResponses = () =>
  createMiddleware(async (c, next) => {
    await next();

    const key = c.get('apiKey');
    if (!key || key.access.full || !c.res.ok) return;
    if (!c.res.headers.get('content-type')?.includes('application/json')) {
      return;
    }

    const body = await c.res.json();
    const headers = new Headers(c.res.headers);
    headers.delete('content-length');
    c.res = new Response(JSON.stringify(maskResponseBody(body, key.access)), {
      status: c.res.status,
      headers,
    });
  });
