import type { z } from 'zod';
import type {
  ApiKeyAccessLevel,
  ApiKeyEntityGrant,
  ApiKeyFieldList,
  ApiKeyMutualGrant,
  ApiKeyPolicies,
  ApiKeyPolicy,
} from '../types/api-key-policy.type';
import type { Entity } from '../types/monorise.type';

/**
 * @description Built-in policy: read, write and delete on every entity and
 * relationship, plus every custom route. Every key in the legacy array form of
 * `API_KEYS` maps to it.
 */
export const FULL_API_KEY_POLICY = 'full';

const ACCESS_LEVELS: readonly ApiKeyAccessLevel[] = ['none', 'read', 'write'];
const SYSTEM_FIELDS = ['$entityId', '$createdAt'];
const ENTITY_GRANT_KEYS = [
  'read',
  'create',
  'update',
  'write',
  'delete',
  'tags',
  'mutuals',
];
const MUTUAL_GRANT_KEYS = ['read', 'create', 'update', 'write', 'delete'];
const POLICY_KEYS = ['entities', 'routes'];

/** `'*'` for every field, or the allowed fields. */
export type ApiKeyFieldAccess = '*' | ReadonlySet<string>;

/** What a policy allows on one entity type. `null` means not granted. */
export type ApiKeyEntityAccess = {
  /** Whether the policy mentions the type at all. An unlisted type answers 404. */
  listed: boolean;
  read: ApiKeyFieldAccess | null;
  create: ApiKeyFieldAccess | null;
  update: ApiKeyFieldAccess | null;
  delete: boolean;
  tags: ApiKeyFieldAccess | null;
};

/** What a policy allows on one direction of a relationship. Fields are `mutualData` fields. */
export type ApiKeyMutualAccess = {
  read: ApiKeyFieldAccess | null;
  create: ApiKeyFieldAccess | null;
  update: ApiKeyFieldAccess | null;
  delete: boolean;
};

export type CompiledApiKeyPolicy = {
  name: string;
  /** True only for the built-in `full` policy. */
  full: boolean;
  entity(entityType: string): ApiKeyEntityAccess;
  /**
   * Access to the direction `byEntityType`→`entityType`, as in
   * `/mutual/:byEntityType/:byEntityId/:entityType`. `null` when either end
   * type isn't listed.
   */
  mutual(byEntityType: string, entityType: string): ApiKeyMutualAccess | null;
  /** Whether the policy grants a custom route permission. `full` grants every one. */
  allowsRoute(permission: string): boolean;
};

type CompiledEntity = {
  access: ApiKeyEntityAccess;
  mutualDefault: ApiKeyAccessLevel;
  mutuals: ReadonlyMap<string, ApiKeyMutualGrant>;
};

const hasOwn = (object: object, key: string) =>
  Object.prototype.hasOwnProperty.call(object, key);

const toAccess = (list: ApiKeyFieldList | undefined) =>
  list === undefined ? null : list === '*' ? '*' : new Set<string>(list);

const union = (
  ...accesses: (ApiKeyFieldAccess | null)[]
): ApiKeyFieldAccess | null => {
  let fields: Set<string> | null = null;
  for (const access of accesses) {
    if (access === null) continue;
    if (access === '*') return '*';
    fields = new Set([...(fields ?? []), ...access]);
  }
  return fields;
};

const withoutSystemFields = (access: ApiKeyFieldAccess | null) =>
  access === null || access === '*'
    ? access
    : new Set([...access].filter((field) => !SYSTEM_FIELDS.includes(field)));

const UNLISTED: CompiledEntity = {
  access: {
    listed: false,
    read: null,
    create: null,
    update: null,
    delete: false,
    tags: null,
  },
  mutualDefault: 'none',
  mutuals: new Map(),
};

const compileEntityGrant = (
  grant: ApiKeyEntityGrant | undefined,
): CompiledEntity => {
  if (grant === undefined || grant === 'none') return UNLISTED;

  if (grant === 'read' || grant === 'write') {
    const write = grant === 'write';
    return {
      access: {
        listed: true,
        read: '*',
        create: write ? '*' : null,
        update: write ? '*' : null,
        delete: write,
        tags: '*',
      },
      mutualDefault: grant,
      mutuals: new Map(),
    };
  }

  const create = union(toAccess(grant.create), toAccess(grant.write));
  const update = union(toAccess(grant.update), toAccess(grant.write));
  const read = union(toAccess(grant.read), withoutSystemFields(create), update);
  const { '*': mutualDefault = 'none', ...mutuals } = grant.mutuals ?? {};

  return {
    access: {
      listed: true,
      read,
      create,
      update,
      delete: grant.delete === true,
      tags:
        grant.tags !== undefined
          ? toAccess(grant.tags)
          : read === '*'
            ? '*'
            : null,
    },
    mutualDefault,
    mutuals: new Map(Object.entries(mutuals) as [string, ApiKeyMutualGrant][]),
  };
};

const compileMutualGrant = (grant: ApiKeyMutualGrant): ApiKeyMutualAccess => {
  if (grant === 'none' || grant === 'read' || grant === 'write') {
    const write = grant === 'write';
    return {
      read: grant === 'none' ? null : '*',
      create: write ? '*' : null,
      update: write ? '*' : null,
      delete: write,
    };
  }

  const create = union(toAccess(grant.create), toAccess(grant.write));
  const update = union(toAccess(grant.update), toAccess(grant.write));
  return {
    read: union(toAccess(grant.read), create, update),
    create,
    update,
    delete: grant.delete === true,
  };
};

/**
 * @description Compiles a policy into the access it grants. Compiled entity
 * grants are cached, so compile once per policy and reuse the result.
 *
 * `name === 'full'` compiles the built-in policy and ignores `policy`.
 */
export const compileApiKeyPolicy = (
  name: string,
  policy?: ApiKeyPolicy,
): CompiledApiKeyPolicy => {
  const full = name === FULL_API_KEY_POLICY;
  const entities: Record<string, ApiKeyEntityGrant | undefined> = full
    ? { '*': 'write' }
    : policy === 'read' || policy === 'write'
      ? { '*': policy }
      : (policy?.entities ?? {});

  const routes = new Set(
    !full && typeof policy === 'object' ? (policy.routes ?? []) : [],
  );

  // Entity types come from request URLs and bodies. Looking them up as own
  // keys stops 'constructor' or '__proto__' from finding Object.prototype, and
  // caching by the grant used means a type the policy doesn't name shares the
  // '*' entry instead of adding one per string a caller sends.
  const cache = new Map<string, CompiledEntity>();
  const compiled = (entityType: string) => {
    const grantKey = hasOwn(entities, entityType) ? entityType : '*';
    let entry = cache.get(grantKey);
    if (!entry) {
      entry = compileEntityGrant(
        hasOwn(entities, grantKey) ? entities[grantKey] : undefined,
      );
      cache.set(grantKey, entry);
    }
    return entry;
  };

  return {
    name,
    full,
    entity: (entityType) => compiled(entityType).access,
    mutual: (byEntityType, entityType) => {
      const from = compiled(byEntityType);
      if (!from.access.listed || !compiled(entityType).access.listed) {
        return null;
      }
      return compileMutualGrant(
        from.mutuals.get(entityType) ?? from.mutualDefault,
      );
    },
    allowsRoute: (permission) => full || routes.has(permission),
  };
};

/**
 * @description The parts of an entity config that policy validation reads.
 * Any config built by `createEntityConfig` satisfies it. Configs are keyed by
 * entity type.
 */
export type ApiKeyPolicyEntityConfig = {
  baseSchema: z.AnyZodObject;
  createSchema?: z.AnyZodObject;
  tags?: { name: string }[];
  mutual?: {
    mutualSchema?: z.AnyZodObject;
    createMutualSchema?: z.AnyZodObject;
    mutualFields?: Record<
      string,
      {
        entityType: string | Entity;
        mutual?: {
          mutualDataSchema?: z.AnyZodObject;
          asEntity?: { name: string | Entity };
        };
      }
    >;
  };
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const quoteList = (items: Iterable<string>) =>
  [...items].map((item) => `'${item}'`).join(', ');

/**
 * @description Checks policies against the entity configs. Returns one message
 * per problem; an empty array means the policies are valid. The CLI runs this
 * at build time and the API handler at cold start.
 */
export const validateApiKeyPolicies = (
  policies: unknown,
  entityConfigs: Record<string, ApiKeyPolicyEntityConfig>,
): string[] => {
  const errors: string[] = [];
  if (!isPlainObject(policies)) {
    return ['API key policies must be an object keyed by policy name'];
  }

  const entityNames = Object.keys(entityConfigs);
  const isEntityType = (name: string) => hasOwn(entityConfigs, name);

  const mutualFieldNames = (config: ApiKeyPolicyEntityConfig) =>
    new Set([
      ...Object.keys(config.mutual?.mutualFields ?? {}),
      ...Object.keys(config.mutual?.mutualSchema?.shape ?? {}),
      ...Object.keys(config.mutual?.createMutualSchema?.shape ?? {}),
    ]);

  const ownFields = (config: ApiKeyPolicyEntityConfig) =>
    new Set([
      ...Object.keys(config.baseSchema?.shape ?? {}),
      ...Object.keys(config.createSchema?.shape ?? {}),
    ]);

  // The mutual config for a pair can be declared on either side.
  const mutualConfig = (byEntityType: string, entityType: string) => {
    const declared = (from: string, to: string) =>
      Object.values(entityConfigs[from]?.mutual?.mutualFields ?? {}).find(
        (field) => field.entityType === to && field.mutual,
      )?.mutual;
    return (
      declared(byEntityType, entityType) ?? declared(entityType, byEntityType)
    );
  };

  const checkFieldList = (
    where: string,
    list: unknown,
    allowed: Set<string> | undefined,
    describe: (field: string) => string | undefined,
  ) => {
    if (list === '*') return;
    if (
      !Array.isArray(list) ||
      !list.every((field) => typeof field === 'string')
    ) {
      errors.push(`${where} must be '*' or an array of field names`);
      return;
    }
    for (const field of list) {
      const problem = describe(field);
      if (problem) errors.push(`${where}: ${problem}`);
      else if (allowed && !allowed.has(field)) {
        errors.push(`${where}: unknown field '${field}'`);
      }
    }
  };

  const checkUnknownKeys = (
    where: string,
    value: Record<string, unknown>,
    known: string[],
  ) => {
    for (const key of Object.keys(value)) {
      if (!known.includes(key)) {
        errors.push(
          `${where}: unknown key '${key}' (expected ${quoteList(known)})`,
        );
      }
    }
  };

  const checkLevel = (where: string, value: unknown) => {
    if (!ACCESS_LEVELS.includes(value as ApiKeyAccessLevel)) {
      errors.push(`${where} must be one of ${quoteList(ACCESS_LEVELS)}`);
    }
  };

  const checkMutualGrant = (
    where: string,
    grant: unknown,
    byEntityType: string,
    entityType: string,
  ) => {
    if (typeof grant === 'string') return checkLevel(where, grant);
    if (!isPlainObject(grant)) {
      errors.push(`${where} must be an access level or an object`);
      return;
    }
    checkUnknownKeys(where, grant, MUTUAL_GRANT_KEYS);
    const dataFields = mutualConfig(byEntityType, entityType)?.mutualDataSchema
      ?.shape;
    const allowed = dataFields ? new Set(Object.keys(dataFields)) : undefined;
    for (const key of ['read', 'create', 'update', 'write']) {
      if (grant[key] === undefined) continue;
      checkFieldList(`${where}.${key}`, grant[key], allowed, () => undefined);
    }
    if (grant.delete !== undefined && typeof grant.delete !== 'boolean') {
      errors.push(`${where}.delete must be a boolean`);
    }
  };

  const checkEntityGrant = (
    where: string,
    grant: unknown,
    entityType: string,
  ) => {
    const config = entityConfigs[entityType];
    if (typeof grant === 'string') return checkLevel(where, grant);
    if (!isPlainObject(grant)) {
      errors.push(`${where} must be an access level or an object`);
      return;
    }
    checkUnknownKeys(where, grant, ENTITY_GRANT_KEYS);

    const fields = ownFields(config);
    const mutualFields = mutualFieldNames(config);
    for (const key of ['read', 'create', 'update', 'write']) {
      if (grant[key] === undefined) continue;
      const allowsSystemFields = key === 'create' || key === 'write';
      const allowed = allowsSystemFields
        ? new Set([...fields, ...SYSTEM_FIELDS])
        : fields;
      checkFieldList(`${where}.${key}`, grant[key], allowed, (field) => {
        if (SYSTEM_FIELDS.includes(field)) {
          return allowsSystemFields
            ? undefined
            : `'${field}' can only be granted in 'create' or 'write'`;
        }
        if (mutualFields.has(field) && !fields.has(field)) {
          return `'${field}' is a relationship field; grant it under 'mutuals' instead`;
        }
        return undefined;
      });
    }
    if (grant.delete !== undefined && typeof grant.delete !== 'boolean') {
      errors.push(`${where}.delete must be a boolean`);
    }
    if (grant.tags !== undefined) {
      checkFieldList(
        `${where}.tags`,
        grant.tags,
        new Set((config.tags ?? []).map((tag) => tag.name)),
        () => undefined,
      );
    }
    if (grant.mutuals !== undefined) {
      if (!isPlainObject(grant.mutuals)) {
        errors.push(`${where}.mutuals must be an object`);
        return;
      }
      for (const [target, mutualGrant] of Object.entries(grant.mutuals)) {
        const mutualWhere = `${where}.mutuals.${target}`;
        if (target === '*') {
          checkLevel(mutualWhere, mutualGrant);
        } else if (!isEntityType(target)) {
          errors.push(`${mutualWhere}: unknown entity type '${target}'`);
        } else {
          checkMutualGrant(mutualWhere, mutualGrant, entityType, target);
        }
      }
    }
  };

  // A create grant that can never succeed is almost certainly a mistake.
  const checkCreateIsSatisfiable = (
    where: string,
    policy: CompiledApiKeyPolicy,
    entityType: string,
  ) => {
    const config = entityConfigs[entityType];
    const { create } = policy.entity(entityType);
    if (create === null) return;

    if (create !== '*') {
      const shape: Record<string, z.ZodTypeAny> = {
        ...config.baseSchema?.shape,
        ...config.createSchema?.shape,
      };
      const missing = Object.entries(shape)
        .filter(([field, schema]) => !schema.isOptional() && !create.has(field))
        .map(([field]) => field);
      if (missing.length) {
        errors.push(
          `${where}: create omits required field(s) ${quoteList(missing)}, so a key with this policy could never create one`,
        );
      }
    }

    const requiredMutuals = config.mutual?.createMutualSchema?.shape ?? {};
    for (const [field, schema] of Object.entries(
      requiredMutuals as Record<string, z.ZodTypeAny>,
    )) {
      const target = config.mutual?.mutualFields?.[field]?.entityType as
        | string
        | undefined;
      if (schema.isOptional() || !target) continue;
      if (!policy.mutual(entityType, target)?.create) {
        errors.push(
          `${where}: create needs create on ${entityType}→${target}, because createMutualSchema requires '${field}'`,
        );
      }
    }
  };

  for (const [name, policy] of Object.entries(policies)) {
    const where = `policy '${name}'`;
    const errorsBefore = errors.length;
    if (name === FULL_API_KEY_POLICY) {
      errors.push(`${where} is built in and cannot be redefined`);
      continue;
    }
    if (policy === 'read' || policy === 'write') continue;
    if (!isPlainObject(policy)) {
      errors.push(`${where} must be 'read', 'write' or an object`);
      continue;
    }
    checkUnknownKeys(where, policy, POLICY_KEYS);

    if (
      policy.routes !== undefined &&
      (!Array.isArray(policy.routes) ||
        !policy.routes.every(
          (permission) => typeof permission === 'string' && permission.length,
        ))
    ) {
      errors.push(`${where}.routes must be an array of permission names`);
    }

    const entities = policy.entities ?? {};
    if (!isPlainObject(entities)) {
      errors.push(`${where}.entities must be an object`);
      continue;
    }
    for (const [entityType, grant] of Object.entries(entities)) {
      const entityWhere = `${where}.entities.${entityType}`;
      if (entityType === '*') {
        checkLevel(entityWhere, grant);
      } else if (!isEntityType(entityType)) {
        errors.push(`${entityWhere}: unknown entity type '${entityType}'`);
      } else {
        checkEntityGrant(entityWhere, grant, entityType);
      }
    }

    // Structural errors would make the semantic checks below misleading.
    if (errors.length > errorsBefore) continue;

    const compiled = compileApiKeyPolicy(name, policy as ApiKeyPolicy);
    for (const entityType of entityNames) {
      const entityWhere = `${where}.entities.${entityType}`;
      checkCreateIsSatisfiable(entityWhere, compiled, entityType);

      for (const target of entityNames) {
        const asEntity = mutualConfig(entityType, target)?.asEntity?.name as
          | string
          | undefined;
        if (
          asEntity &&
          compiled.mutual(entityType, target)?.create &&
          !compiled.entity(asEntity).create
        ) {
          errors.push(
            `${entityWhere}: create on ${entityType}→${target} also creates a '${asEntity}' entity, so it needs create on '${asEntity}'`,
          );
        }
      }
    }
  }

  return errors;
};

const VALIDATE_API_KEY_POLICIES = Symbol.for('monorise.validateApiKeyPolicies');

/**
 * @description Declares the API key policies. Export the result as the default
 * export of the file `apiKeys` points to in `monorise.config.ts`; `API_KEYS`
 * then maps each policy name to its keys. `full` is built in.
 *
 * @example
 * ```ts
 * export default defineApiKeyPolicies({
 *   'agent-read': 'read',
 *   client: {
 *     entities: {
 *       [Entity.ORDER]: { read: '*', create: ['customerId', 'items'], update: ['status'] },
 *       [Entity.PRODUCT]: 'read',
 *     },
 *   },
 * });
 * ```
 */
export const defineApiKeyPolicies = (
  policies: ApiKeyPolicies,
): ApiKeyPolicies => {
  // Lets the CLI validate the policies with this same version of the
  // validator, without resolving @monorise/base from the project itself.
  Object.defineProperty(policies, VALIDATE_API_KEY_POLICIES, {
    value: (entityConfigs: Record<string, ApiKeyPolicyEntityConfig>) =>
      validateApiKeyPolicies(policies, entityConfigs),
    enumerable: false,
  });
  return policies;
};
