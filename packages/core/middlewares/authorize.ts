import type { ApiKeyEntityAccess } from '@monorise/base';
import type { Context, MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import httpStatus from 'http-status';

export type EntityAction = 'read' | 'create' | 'update' | 'delete';

const ROUTE_GUARD = Symbol.for('monorise.routeGuard');

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

// Same body entityTypeCheck answers for a type the API doesn't serve, so a
// type the key can't see is indistinguishable from one that doesn't exist.
const notFound = (c: Context, details?: Record<string, unknown>) => {
  c.status(httpStatus.NOT_FOUND);
  return c.json({ code: 'NOT_FOUND', ...details });
};

const forbidden = (
  c: Context,
  message: string,
  details?: Record<string, unknown>,
) => {
  c.status(httpStatus.FORBIDDEN);
  return c.json({ code: 'FORBIDDEN', message, ...details });
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

const deniedMessage = (policy: string, action: string, entityType: string) =>
  `API key policy '${policy}' does not allow ${action} on '${entityType}'`;

/**
 * Requires every listed action on the route's `:entityType`. A type the key's
 * policy doesn't list answers 404; a listed type without the action, 403.
 */
export const requireEntity = (...actions: EntityAction[]) =>
  routeGuard(
    `entity:${actions.join('+')}`,
    createMiddleware(async (c, next) => {
      const key = restrictedKey(c);
      if (key) {
        const entityType = c.req.param('entityType') ?? '';
        const access = key.access.entity(entityType);
        if (!access.listed) return notFound(c);

        const denied = actions.find(
          (action) => !allowsEntityAction(access, action),
        );
        if (denied) {
          return forbidden(c, deniedMessage(key.policy, denied, entityType));
        }
      }
      await next();
    }),
  );

/**
 * Requires both types in a `/mutual/:byEntityType/:byEntityId/:entityType`
 * route to be listed.
 */
export const requireMutualTypes = () =>
  routeGuard(
    'mutual:types',
    createMiddleware(async (c, next) => {
      const key = restrictedKey(c);
      if (key) {
        const byEntityType = c.req.param('byEntityType') ?? '';
        const entityType = c.req.param('entityType') ?? '';
        if (
          !key.access.entity(byEntityType).listed ||
          !key.access.entity(entityType).listed
        ) {
          return notFound(c);
        }
      }
      await next();
    }),
  );

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

const ENTITY_OPERATION_ACTIONS: Record<string, EntityAction> = {
  createEntity: 'create',
  updateEntity: 'update',
  adjustEntity: 'update',
  deleteEntity: 'delete',
};

const MUTUAL_OPERATIONS = ['createMutual', 'updateMutual', 'deleteMutual'];

/**
 * Checks every operation of a `POST /transaction` before any of them runs.
 * One operation the key can't perform rejects the whole transaction, with
 * its index. A malformed body passes through, for the controller's 400.
 */
export const requireTransactionOperations = () =>
  routeGuard(
    'transaction',
    createMiddleware(async (c, next) => {
      const key = restrictedKey(c);
      if (!key) return next();

      let operations: unknown;
      try {
        operations = (await c.req.json())?.operations;
      } catch {
        return next();
      }
      if (!Array.isArray(operations)) return next();

      for (const [operationIndex, operation] of operations.entries()) {
        const action = ENTITY_OPERATION_ACTIONS[operation?.operation];
        if (action) {
          const access = key.access.entity(operation.entityType);
          if (!access.listed) return notFound(c, { operationIndex });
          if (!allowsEntityAction(access, action)) {
            return forbidden(
              c,
              deniedMessage(key.policy, action, operation.entityType),
              { operationIndex },
            );
          }
        } else if (MUTUAL_OPERATIONS.includes(operation?.operation)) {
          if (
            !key.access.entity(operation.byEntityType).listed ||
            !key.access.entity(operation.entityType).listed
          ) {
            return notFound(c, { operationIndex });
          }
        }
      }
      await next();
    }),
  );
