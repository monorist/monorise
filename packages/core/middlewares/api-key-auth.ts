import { createHash } from 'node:crypto';
import {
  type ApiKeyPolicies,
  type ApiKeyPolicyEntityConfig,
  type ApiKeyRoutePermission,
  type CompiledApiKeyPolicy,
  FULL_API_KEY_POLICY,
  compileApiKeyPolicy,
  validateApiKeyPolicies,
} from '@monorise/base';
import { createFactory } from 'hono/factory';
import httpStatus from 'http-status';
import type { EntityAction } from './authorize';

const SHA256_PREFIX = 'sha256:';

export type ApiKeyPrincipal = {
  /** Name of the policy the request's key maps to, e.g. `'full'`. */
  policy: string;
  /** SHA-256 hex digest of the key. Safe to log or store; the key itself is not. */
  fingerprint: string;
  /** What the policy grants, per entity type and relationship direction. */
  access: CompiledApiKeyPolicy;
  /**
   * Whether the policy allows an action on an entity type, and on every
   * listed field when `fields` is given.
   */
  can(
    action: EntityAction,
    entityType: string,
    fields?: readonly string[],
  ): boolean;
  /** Whether the policy grants a custom route permission. */
  has(permission: ApiKeyRoutePermission): boolean;
};

const createPrincipal = (
  policy: string,
  access: CompiledApiKeyPolicy,
): Omit<ApiKeyPrincipal, 'fingerprint'> => ({
  policy,
  access,
  can: (action, entityType, fields) => {
    const entity = access.entity(entityType);
    if (action === 'delete') return entity.delete;
    const granted = entity[action];
    if (granted === null) return false;
    return !fields || granted === '*' || fields.every((f) => granted.has(f));
  },
  has: (permission) => access.allowsRoute(permission),
});

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
  definedPolicies: readonly string[] = [FULL_API_KEY_POLICY],
): Map<string, string> => {
  const fingerprints = new Map<string, string>();
  if (!raw) return fingerprints;

  const parsed: unknown = JSON.parse(raw);

  if (Array.isArray(parsed)) {
    for (const key of assertKeyList(parsed, 'the array form')) {
      fingerprints.set(toFingerprint(key), FULL_API_KEY_POLICY);
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

export const createApiKeyAuth = (
  fingerprints: Map<string, string>,
  policies: ApiKeyPolicies = {},
) => {
  // One principal per policy, shared by every request with a key under it.
  const principals = new Map<string, Omit<ApiKeyPrincipal, 'fingerprint'>>();
  const principalFor = (name: string) => {
    let principal = principals.get(name);
    if (!principal) {
      principal = createPrincipal(
        name,
        compileApiKeyPolicy(name, policies[name]),
      );
      principals.set(name, principal);
    }
    return principal;
  };

  return factory.createMiddleware(async (c, next) => {
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

    c.set('apiKey', { ...principalFor(policy), fingerprint });
    return await next();
  });
};

/**
 * Builds the API key middleware for the project's policies. The CLI validates
 * the policies at build time; this validates them again at cold start, and
 * if they don't match the entity configs, rejects every key under them.
 */
export const apiKeyAuth = ({
  policies = {},
  entityConfig,
  apiKeys = process.env.API_KEYS,
}: {
  policies?: ApiKeyPolicies;
  entityConfig: Record<string, ApiKeyPolicyEntityConfig>;
  apiKeys?: string;
}) => {
  const errors = validateApiKeyPolicies(policies, entityConfig);
  if (errors.length) {
    // Not a throw: the generated handle.ts builds this for the API, but every
    // processor imports the same module, so a throw would stop them all from
    // starting. Failing closed for these policies keeps the blast radius to
    // the keys that depend on them; `full` keys keep working.
    console.error(
      `[monorise] Invalid API key policies; every key under them will be rejected:\n  - ${errors.join('\n  - ')}`,
    );
  }

  return createApiKeyAuth(
    parseApiKeys(
      apiKeys,
      errors.length
        ? [FULL_API_KEY_POLICY]
        : [FULL_API_KEY_POLICY, ...Object.keys(policies)],
    ),
    policies,
  );
};
