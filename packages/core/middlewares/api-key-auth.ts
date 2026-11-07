import { createHash } from 'node:crypto';
import { createFactory } from 'hono/factory';
import httpStatus from 'http-status';

/**
 * Built-in policy: read, write and delete on every entity, relationship and
 * custom route. Every key in the legacy array form of `API_KEYS` maps to it.
 */
export const FULL_POLICY = 'full';

const SHA256_PREFIX = 'sha256:';

export type ApiKeyPrincipal = {
  /** Name of the policy the request's key maps to, e.g. `'full'`. */
  policy: string;
  /** SHA-256 hex digest of the key. Safe to log or store; the key itself is not. */
  fingerprint: string;
};

declare module 'hono' {
  interface ContextVariableMap {
    apiKey: ApiKeyPrincipal;
  }
}

export const fingerprintApiKey = (key: string): string =>
  createHash('sha256').update(key).digest('hex');

const toFingerprint = (entry: string): string =>
  entry.startsWith(SHA256_PREFIX)
    ? entry.slice(SHA256_PREFIX.length).toLowerCase()
    : fingerprintApiKey(entry);

const assertKeyList = (value: unknown, where: string): string[] => {
  if (
    !Array.isArray(value) ||
    !value.every((key) => typeof key === 'string' && key.length > 0)
  ) {
    throw new Error(
      `[monorise] API_KEYS: ${where} must be an array of non-empty strings`,
    );
  }
  return value;
};

/**
 * Parses `API_KEYS` into a map from key fingerprint to policy name.
 *
 * Accepts the legacy array form, where every key gets `full`:
 *   `["key-1", "key-2"]`
 * and the object form, which maps policy names to keys:
 *   `{"full": ["key-1"], "reporting": ["key-2", "sha256:<hex>"]}`
 *
 * A `sha256:` entry is a pre-hashed key, so the secret need not hold the key
 * itself. Keys under a policy name that isn't defined, or listed under two
 * policies, are dropped with an error log: they fail closed with a 401.
 */
export const parseApiKeys = (
  raw: string | undefined,
  definedPolicies: readonly string[] = [FULL_POLICY],
): Map<string, string> => {
  const fingerprints = new Map<string, string>();
  if (!raw) return fingerprints;

  const parsed: unknown = JSON.parse(raw);

  if (Array.isArray(parsed)) {
    for (const key of assertKeyList(parsed, 'the array form')) {
      fingerprints.set(toFingerprint(key), FULL_POLICY);
    }
    return fingerprints;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(
      '[monorise] API_KEYS must be a JSON array of keys or an object mapping policy names to keys',
    );
  }

  const policiesByFingerprint = new Map<string, Set<string>>();
  for (const [policy, keys] of Object.entries(parsed)) {
    const keyList = assertKeyList(keys, `policy '${policy}'`);
    if (!definedPolicies.includes(policy)) {
      console.error(
        `[monorise] API_KEYS: policy '${policy}' is not defined; its ${keyList.length} key(s) will be rejected`,
      );
    }
    for (const key of keyList) {
      const fingerprint = toFingerprint(key);
      const policies = policiesByFingerprint.get(fingerprint) ?? new Set();
      policies.add(policy);
      policiesByFingerprint.set(fingerprint, policies);
    }
  }

  for (const [fingerprint, policies] of policiesByFingerprint) {
    if (policies.size > 1) {
      console.error(
        `[monorise] API_KEYS: key ${fingerprint.slice(0, 12)}… is listed under more than one policy (${[...policies].join(', ')}) and will be rejected`,
      );
      continue;
    }
    const [policy] = policies;
    if (definedPolicies.includes(policy)) fingerprints.set(fingerprint, policy);
  }

  return fingerprints;
};

const factory = createFactory();

export const createApiKeyAuth = (fingerprints: Map<string, string>) =>
  factory.createMiddleware(async (c, next) => {
    const xApiKey = c.req.header('x-api-key');
    const fingerprint = xApiKey ? fingerprintApiKey(xApiKey) : undefined;
    const policy = fingerprint ? fingerprints.get(fingerprint) : undefined;

    if (!fingerprint || !policy) {
      c.status(httpStatus.UNAUTHORIZED);
      return c.json({
        status: httpStatus.UNAUTHORIZED,
        message: httpStatus['401_MESSAGE'],
      });
    }

    c.set('apiKey', { policy, fingerprint });
    return await next();
  });

const apiKeyAuth = createApiKeyAuth(parseApiKeys(process.env.API_KEYS));

export default apiKeyAuth;
