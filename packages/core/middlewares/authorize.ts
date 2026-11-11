import type {
  ApiKeyEntityAccess,
  ApiKeyFieldAccess,
  ApiKeyPolicyEntityConfig,
  ApiKeyRoutePermission,
} from '@monorise/base';
import type { Context, MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import httpStatus from 'http-status';
import type { ApiKeyPrincipal } from './api-key-auth';

export type EntityAction = 'read' | 'create' | 'update' | 'delete';

/** The kinds of entity route, each with its own requirement and body. */
export type EntityRoute =
  | 'read'
  | 'create'
  | 'update'
  | 'upsert'
  | 'adjust'
  | 'delete';

const ENTITY_ROUTE_ACTIONS: Record<EntityRoute, EntityAction[]> = {
  read: ['read'],
  create: ['create'],
  update: ['update'],
  // Upsert creates or updates depending on whether the entity exists, and
  // checking which before the write would race, so it needs both.
  upsert: ['create', 'update'],
  adjust: ['update'],
  delete: ['delete'],
};

type EntityConfigs = Record<string, ApiKeyPolicyEntityConfig>;

// Why a request is refused: 404 for a type the key's policy doesn't list,
// 403 for anything else it doesn't grant. `fields` lists the fields a
// write may not set.
type Denial =
  | { status: 404 }
  | { status: 403; message: string; fields?: string[] };

const ROUTE_GUARD = Symbol.for('monorise.routeGuard');
const ROUTE_PERMISSION = Symbol.for('monorise.routePermission');

// Request-body keys the controllers take out before writing: not data fields.
const NOT_DATA = new Set(['$condition', '$where']);

// Tags a guard with what it requires, so a test can check that every route
// declares a requirement and that each one is the intended requirement.
const routeGuard = (
  requirement: string,
  middleware: MiddlewareHandler,
): MiddlewareHandler =>
  Object.defineProperty(middleware, ROUTE_GUARD, { value: requirement });

/** The requirement a guard declares, e.g. `'entity:read'`; `undefined` for any other handler. */
export const routeGuardRequirement = (handler: unknown): string | undefined =>
  typeof handler === 'function'
    ? (handler as unknown as Record<symbol, string | undefined>)[ROUTE_GUARD]
    : undefined;

const forbidden = (
  c: Context,
  message: string,
  details?: Record<string, unknown>,
) => {
  c.status(httpStatus.FORBIDDEN);
  return c.json({ code: 'FORBIDDEN', message, ...details });
};

const deny = (
  c: Context,
  denial: Denial,
  details?: Record<string, unknown>,
) => {
  if (denial.status === 403 && denial.fields) {
    c.status(httpStatus.FORBIDDEN);
    return c.json({
      code: 'FORBIDDEN_FIELDS',
      message: denial.message,
      fields: denial.fields,
      ...details,
    });
  }
  if (denial.status === 403) return forbidden(c, denial.message, details);
  // Same body entityTypeCheck answers for a type the API doesn't serve, so a
  // type the key can't see is indistinguishable from one that doesn't exist.
  c.status(httpStatus.NOT_FOUND);
  return c.json({ code: 'NOT_FOUND', ...details });
};

export const allowsEntityAction = (
  access: ApiKeyEntityAccess,
  action: EntityAction,
) => (action === 'delete' ? access.delete : access[action] !== null);

// The key to check, or undefined when the request is unrestricted: a `full`
// key, or no key at all because setupCommonRoutes is mounted in an app that
// authenticates on its own instead of through apiKeyAuth.
const restrictedKey = (c: Context) => {
  const key = c.get('apiKey');
  return key && !key.access.full ? key : undefined;
};

const jsonBody = async (c: Context): Promise<unknown> => {
  try {
    return await c.req.json();
  } catch {
    // A malformed body is the controller's to reject with a 400.
    return undefined;
  }
};

/**
 * Builds the guards for the built-in routes. They need the entity configs to
 * know which payload fields are relationships, and which relationships also
 * create an `asEntity` entity.
 */
export const createRouteGuards = (entityConfig: EntityConfigs) => {
  const checkEntity = (
    key: ApiKeyPrincipal,
    entityType: string,
    action: EntityAction,
  ): Denial | null => {
    const access = key.access.entity(entityType);
    if (!access.listed) return { status: 404 };
    if (allowsEntityAction(access, action)) return null;
    return {
      status: 403,
      message: `API key policy '${key.policy}' does not allow ${action} on '${entityType}'`,
    };
  };

  // The asEntity type a relationship creates; its config can be on either side.
  const asEntityType = (byEntityType: string, entityType: string) => {
    const declared = (from: string, to: string) =>
      Object.values(entityConfig[from]?.mutual?.mutualFields ?? {}).find(
        (field) => field.entityType === to && field.mutual,
      )?.mutual?.asEntity?.name as string | undefined;
    return (
      declared(byEntityType, entityType) ?? declared(entityType, byEntityType)
    );
  };

  /**
   * Checks one direction, byEntityType→entityType, as the URL orders it.
   * `requestedAsEntity` is an `asEntity` the request names, which wins over
   * the config's.
   */
  const checkDirection = (
    key: ApiKeyPrincipal,
    byEntityType: string,
    entityType: string,
    action: EntityAction,
    requestedAsEntity?: string,
  ): Denial | null => {
    const access = key.access.mutual(byEntityType, entityType);
    if (!access) return { status: 404 };

    const granted =
      action === 'delete' ? access.delete : access[action] !== null;
    if (!granted) {
      return {
        status: 403,
        message: `API key policy '${key.policy}' does not allow ${action} on ${byEntityType}→${entityType}`,
      };
    }

    const asEntity =
      action === 'create'
        ? requestedAsEntity || asEntityType(byEntityType, entityType)
        : undefined;
    if (asEntity && !key.access.entity(asEntity).create) {
      return {
        status: 403,
        message: `API key policy '${key.policy}' does not allow create on '${asEntity}', which ${byEntityType}→${entityType} creates`,
      };
    }
    return null;
  };

  const quoted = (fields: string[]) =>
    fields.map((field) => `'${field}'`).join(', ');

  /** Fields outside `granted`, which is `'*'`, an allowlist, or `null` for none. */
  const checkFields = (
    key: ApiKeyPrincipal,
    granted: ApiKeyFieldAccess | null,
    fields: string[],
    what: string,
  ): Denial | null => {
    const disallowed =
      granted === '*' ? [] : fields.filter((field) => !granted?.has(field));
    if (!disallowed.length) return null;
    return {
      status: 403,
      message: `API key policy '${key.policy}' does not allow ${what}: ${quoted(disallowed)}`,
      fields: disallowed,
    };
  };

  const relationshipFieldNames = (entityType: string) =>
    new Set(Object.keys(entityConfig[entityType]?.mutual?.mutualFields ?? {}));

  // The data fields a payload sets. Relationship fields are checked against
  // their direction instead. The controllers take only $condition and $where
  // out of the body, so any other `$` key is written as data and checked.
  const dataFields = (entityType: string, payload: unknown) => {
    if (typeof payload !== 'object' || payload === null) return [];
    const relationships = relationshipFieldNames(entityType);
    return Object.keys(payload).filter(
      (field) => !NOT_DATA.has(field) && !relationships.has(field),
    );
  };

  // A create body may also choose the entity's ID and backdate createdAt,
  // which only a create list naming $entityId or $createdAt allows.
  const createFields = (
    entityType: string,
    payload: unknown,
    choosesEntityId: boolean,
  ) => {
    const fields = dataFields(entityType, payload).map((field) =>
      field === 'entityId'
        ? '$entityId'
        : field === 'createdAt'
          ? '$createdAt'
          : field,
    );
    if (choosesEntityId && !fields.includes('$entityId')) {
      fields.push('$entityId');
    }
    return fields;
  };

  /**
   * Relationship fields in an entity payload write the direction from that
   * entity to the field's target. On create they only add relationships; on
   * update the new list replaces the old one, so it can also remove some.
   */
  const checkRelationshipFields = (
    key: ApiKeyPrincipal,
    entityType: string,
    payload: unknown,
    write: 'create' | 'update',
  ): Denial | null => {
    if (typeof payload !== 'object' || payload === null) return null;
    const relationshipFields = entityConfig[entityType]?.mutual?.mutualFields;
    if (!relationshipFields) return null;

    const actions: EntityAction[] =
      write === 'create' ? ['create'] : ['create', 'delete'];
    for (const field of Object.keys(payload)) {
      const target = relationshipFields[field]?.entityType as
        | string
        | undefined;
      if (!target) continue;
      for (const action of actions) {
        const denial = checkDirection(key, entityType, target, action);
        if (denial) return denial;
      }
    }
    return null;
  };

  const checkCreate = (
    key: ApiKeyPrincipal,
    entityType: string,
    payload: unknown,
    choosesEntityId: boolean,
  ) =>
    checkRelationshipFields(key, entityType, payload, 'create') ??
    checkFields(
      key,
      key.access.entity(entityType).create,
      createFields(entityType, payload, choosesEntityId),
      `create on these fields of '${entityType}'`,
    );

  const checkUpdate = (
    key: ApiKeyPrincipal,
    entityType: string,
    payload: unknown,
  ) => {
    const access = key.access.entity(entityType);
    // Legacy $where conditions read the fields they name: a 200 vs 409
    // answer would otherwise reveal values the key cannot read.
    const where = (payload as { $where?: unknown } | null)?.$where;
    return (
      checkRelationshipFields(key, entityType, payload, 'update') ??
      checkFields(
        key,
        access.update,
        dataFields(entityType, payload),
        `update on these fields of '${entityType}'`,
      ) ??
      (typeof where === 'object' && where !== null
        ? checkFields(
            key,
            access.read,
            Object.keys(where),
            `$where on these fields of '${entityType}', which it cannot read`,
          )
        : null)
    );
  };

  const checkAdjust = (
    key: ApiKeyPrincipal,
    entityType: string,
    adjustments: unknown,
  ) =>
    checkFields(
      key,
      key.access.entity(entityType).update,
      dataFields(entityType, adjustments),
      `adjust on these fields of '${entityType}'`,
    );

  /**
   * Requires the route's actions on `:entityType`, then checks what the body
   * writes: data fields against the create or update list, relationship
   * fields against their direction.
   */
  const entity = (route: EntityRoute) =>
    routeGuard(
      `entity:${route}`,
      createMiddleware(async (c, next) => {
        const key = restrictedKey(c);
        if (key) {
          const entityType = c.req.param('entityType') ?? '';
          for (const action of ENTITY_ROUTE_ACTIONS[route]) {
            const denial = checkEntity(key, entityType, action);
            if (denial) return deny(c, denial);
          }

          let denial: Denial | null = null;
          if (route === 'create') {
            denial = checkCreate(key, entityType, await jsonBody(c), false);
          } else if (route === 'update') {
            denial = checkUpdate(key, entityType, await jsonBody(c));
          } else if (route === 'upsert') {
            // The URL chooses the ID, so an upsert that creates needs $entityId.
            const body = await jsonBody(c);
            denial =
              checkCreate(key, entityType, body, true) ??
              checkUpdate(key, entityType, body);
          } else if (route === 'adjust') {
            denial = checkAdjust(key, entityType, await jsonBody(c));
          }
          if (denial) return deny(c, denial);
        }
        await next();
      }),
    );

  // mutualData fields a create or update of a relationship sets.
  const checkMutualData = (
    key: ApiKeyPrincipal,
    byEntityType: string,
    entityType: string,
    action: 'create' | 'update',
    payload: unknown,
  ) =>
    typeof payload === 'object' && payload !== null
      ? checkFields(
          key,
          key.access.mutual(byEntityType, entityType)?.[action] ?? null,
          Object.keys(payload),
          `${action} on these mutualData fields of ${byEntityType}→${entityType}`,
        )
      : null;

  /**
   * Requires an action on the route's direction,
   * `/mutual/:byEntityType/:byEntityId/:entityType`. A chain query reads
   * every direction along the chain.
   */
  const mutual = (action: EntityAction) =>
    routeGuard(
      `mutual:${action}`,
      createMiddleware(async (c, next) => {
        const key = restrictedKey(c);
        if (key) {
          const byEntityType = c.req.param('byEntityType') ?? '';
          const entityType = c.req.param('entityType') ?? '';
          const chain = c.req.query('chainEntityQuery');
          const path =
            action === 'read' && chain
              ? [byEntityType, ...chain.split(','), entityType]
              : [byEntityType, entityType];

          // CreateMutualController passes ?asEntity= through to the service.
          const requestedAsEntity =
            action === 'create' ? c.req.query('asEntity') : undefined;
          for (let hop = 1; hop < path.length; hop++) {
            const denial = checkDirection(
              key,
              path[hop - 1],
              path[hop],
              action,
              requestedAsEntity,
            );
            if (denial) return deny(c, denial);
          }

          if (action === 'create' || action === 'update') {
            const denial = checkMutualData(
              key,
              byEntityType,
              entityType,
              action,
              await jsonBody(c),
            );
            if (denial) return deny(c, denial);
          }
        }
        await next();
      }),
    );

  const checkOperation = (
    key: ApiKeyPrincipal,
    // biome-ignore lint/suspicious/noExplicitAny: an unvalidated request body
    operation: any,
  ): Denial | null => {
    switch (operation?.operation) {
      case 'createEntity':
        return (
          checkEntity(key, operation.entityType, 'create') ??
          checkCreate(
            key,
            operation.entityType,
            operation.payload,
            Boolean(operation.entityId),
          )
        );
      case 'updateEntity':
        return (
          checkEntity(key, operation.entityType, 'update') ??
          checkUpdate(key, operation.entityType, operation.payload)
        );
      case 'adjustEntity':
        return (
          checkEntity(key, operation.entityType, 'update') ??
          checkAdjust(key, operation.entityType, operation.adjustments)
        );
      case 'deleteEntity':
        return checkEntity(key, operation.entityType, 'delete');
      case 'createMutual':
        return (
          checkDirection(
            key,
            operation.byEntityType,
            operation.entityType,
            'create',
          ) ??
          checkMutualData(
            key,
            operation.byEntityType,
            operation.entityType,
            'create',
            operation.payload,
          )
        );
      case 'updateMutual':
        return (
          checkDirection(
            key,
            operation.byEntityType,
            operation.entityType,
            'update',
          ) ??
          checkMutualData(
            key,
            operation.byEntityType,
            operation.entityType,
            'update',
            operation.payload,
          )
        );
      case 'deleteMutual':
        return checkDirection(
          key,
          operation.byEntityType,
          operation.entityType,
          'delete',
        );
      default:
        // Unknown operations are the controller's to reject with a 400.
        return null;
    }
  };

  /**
   * Checks every operation of a `POST /transaction` before any of them runs.
   * One operation the key can't perform rejects the whole transaction, with
   * its index. A malformed body passes through, for the controller's 400.
   */
  const transaction = () =>
    routeGuard(
      'transaction',
      createMiddleware(async (c, next) => {
        const key = restrictedKey(c);
        if (!key) return next();

        const operations = ((await jsonBody(c)) as { operations?: unknown })
          ?.operations;
        if (!Array.isArray(operations)) return next();

        for (const [operationIndex, operation] of operations.entries()) {
          const denial = checkOperation(key, operation);
          if (denial) return deny(c, denial, { operationIndex });
        }
        await next();
      }),
    );

  return { entity, mutual, transaction };
};

/** Only keys on the built-in `full` policy may call the route. */
export const requireFullPolicy = () =>
  routeGuard(
    'full',
    createMiddleware(async (c, next) => {
      const key = restrictedKey(c);
      if (key) {
        return forbidden(
          c,
          `API key policy '${key.policy}' cannot call this route; only 'full' can`,
        );
      }
      await next();
    }),
  );

/**
 * Declares the permission a custom route requires. Policies grant it by name
 * in `routes`; `full` keys always pass. Works per route or on a group:
 *
 * @example
 * ```ts
 * app.post('/checkout', requires('checkout'), handler);
 * app.use('/reports/*', requires('reports'));
 * ```
 */
export const requires = (
  permission: ApiKeyRoutePermission,
): MiddlewareHandler =>
  Object.defineProperty(
    createMiddleware(async (c, next) => {
      const key = restrictedKey(c);
      if (key && !key.has(permission)) {
        return forbidden(
          c,
          `API key policy '${key.policy}' does not grant '${permission}'`,
        );
      }
      await next();
    }),
    ROUTE_PERMISSION,
    { value: permission },
  );

/**
 * Runs in front of the custom routes. A route that declares no permission
 * with `requires()` is callable only by `full` keys, so a custom route never
 * opens up to scoped keys by accident.
 *
 * The gate checks every `requires()` the request matches itself, before any
 * custom handler runs. A handler that responds first, an `.all()` route, or
 * a `requires()` registered after the route can't skip the check.
 */
export const customRouteGate = () =>
  createMiddleware(async (c, next) => {
    const key = restrictedKey(c);
    if (key) {
      // `matchedRoutes` lists every handler the request will run, including
      // the custom app's own, before any of them runs.
      const permissions = c.req.matchedRoutes.flatMap((route) => {
        const permission = (
          route.handler as unknown as Record<symbol, unknown>
        )[ROUTE_PERMISSION];
        return typeof permission === 'string'
          ? [permission as ApiKeyRoutePermission]
          : [];
      });
      if (!permissions.length) {
        return forbidden(
          c,
          "This route declares no permission with requires(), so only 'full' keys can call it",
        );
      }
      const missing = permissions.find((permission) => !key.has(permission));
      if (missing !== undefined) {
        return forbidden(
          c,
          `API key policy '${key.policy}' does not grant '${missing}'`,
        );
      }
    }
    await next();
  });
