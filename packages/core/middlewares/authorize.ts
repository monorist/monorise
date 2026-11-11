import type {
  ApiKeyEntityAccess,
  ApiKeyPolicyEntityConfig,
  ApiKeyRoutePermission,
} from '@monorise/base';
import type { Context, MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import httpStatus from 'http-status';
import type { ApiKeyPrincipal } from './api-key-auth';

export type EntityAction = 'read' | 'create' | 'update' | 'delete';

type EntityConfigs = Record<string, ApiKeyPolicyEntityConfig>;

// Why a request is refused: 404 for a type the key's policy doesn't list,
// 403 for anything else it doesn't grant.
type Denial = { status: 404 } | { status: 403; message: string };

const ROUTE_GUARD = Symbol.for('monorise.routeGuard');
const ROUTE_PERMISSION = Symbol.for('monorise.routePermission');

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

  /**
   * Requires every listed action on the route's `:entityType`, and the right
   * direction grants for any relationship fields in a create or update body.
   */
  const entity = (...actions: EntityAction[]) =>
    routeGuard(
      `entity:${actions.join('+')}`,
      createMiddleware(async (c, next) => {
        const key = restrictedKey(c);
        if (key) {
          const entityType = c.req.param('entityType') ?? '';
          for (const action of actions) {
            const denial = checkEntity(key, entityType, action);
            if (denial) return deny(c, denial);
          }

          // Upsert can update, so a body that can update is checked as one.
          const write = actions.includes('update')
            ? 'update'
            : actions.includes('create')
              ? 'create'
              : undefined;
          if (write) {
            const denial = checkRelationshipFields(
              key,
              entityType,
              await jsonBody(c),
              write,
            );
            if (denial) return deny(c, denial);
          }
        }
        await next();
      }),
    );

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
          checkRelationshipFields(
            key,
            operation.entityType,
            operation.payload,
            'create',
          )
        );
      case 'updateEntity':
        return (
          checkEntity(key, operation.entityType, 'update') ??
          checkRelationshipFields(
            key,
            operation.entityType,
            operation.payload,
            'update',
          )
        );
      case 'adjustEntity':
        return checkEntity(key, operation.entityType, 'update');
      case 'deleteEntity':
        return checkEntity(key, operation.entityType, 'delete');
      case 'createMutual':
        return checkDirection(
          key,
          operation.byEntityType,
          operation.entityType,
          'create',
        );
      case 'updateMutual':
        return checkDirection(
          key,
          operation.byEntityType,
          operation.entityType,
          'update',
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
 */
export const customRouteGate = () =>
  createMiddleware(async (c, next) => {
    const key = restrictedKey(c);
    // `matchedRoutes` lists every handler the request will run, including
    // the custom app's own, before any of them runs.
    if (
      key &&
      !c.req.matchedRoutes.some(
        (route) =>
          (route.handler as unknown as Record<symbol, unknown>)[
            ROUTE_PERMISSION
          ] !== undefined,
      )
    ) {
      return forbidden(
        c,
        "This route declares no permission with requires(), so only 'full' keys can call it",
      );
    }
    await next();
  });
