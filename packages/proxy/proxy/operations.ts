/**
 * A request to Monorise Core, described as the operations rules are written
 * against: one per thing it reads or writes. Rules on operations rather than
 * URLs can't be bypassed by a different request shape: a transaction's
 * `deleteEntity` and a `DELETE /entity/...` are the same operation.
 */

export type EntityAction = 'get' | 'list' | 'create' | 'update' | 'delete';

/** Relationships have a single `read`: their listings are bounded by `byEntityId`. */
export type RelationshipAction = 'read' | 'create' | 'update' | 'delete';

export type EntityOperation = {
  kind: 'entity';
  action: EntityAction;
  entityType: string;
  entityId?: string;
  payload?: Record<string, unknown>;
  /** The search term of a `list`, as Core receives it. */
  query?: string;
  /** The field and value of a get by unique field. */
  unique?: { field: string; value: string };
  /** The tag a `list` queries. */
  tag?: string;
  /** The tag group a tag listing reads, often what a rule scopes by. */
  group?: string;
  /** The range a `list` reads: Core's `start` and `end` query parameters. */
  start?: string;
  end?: string;
  /** Position in a transaction's `operations`. */
  operationIndex?: number;
};

export type RelationshipOperation = {
  kind: 'relationship';
  action: RelationshipAction;
  byEntityType: string;
  /**
   * Absent for a relationship field on an entity created without an ID, and
   * for every hop of a chain query after the first.
   */
  byEntityId?: string;
  entityType: string;
  /** Absent when listing, and for the relationships an update's new list removes. */
  entityId?: string;
  /** `mutualData`. */
  payload?: Record<string, unknown>;
  operationIndex?: number;
};

export type RouteOperation = {
  kind: 'route';
  method: string;
  /** The path under `/core`, e.g. `/app/invite-casting`. */
  path: string;
  body?: unknown;
};

export type ProxyOperation =
  | EntityOperation
  | RelationshipOperation
  | RouteOperation;

export type ParseResult =
  | { ok: true; operations: ProxyOperation[] }
  | { ok: false; status: 400 | 404; message: string };

/**
 * The parts of the generated config the parser reads: which payload fields of
 * each entity are relationships, and to which entity type.
 */
export type ProxyEntityConfig = Record<
  string,
  { mutual?: { mutualFields?: Record<string, { entityType: string }> } }
>;

const hasOwn = (object: object, key: string) =>
  Object.prototype.hasOwnProperty.call(object, key);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const notFound = (message: string): ParseResult => ({
  ok: false,
  status: 404,
  message,
});

const invalid = (message: string): ParseResult => ({
  ok: false,
  status: 400,
  message,
});

/**
 * A relationship field in an entity payload writes the relationship from that
 * entity to each listed ID. On create it only adds relationships. On update
 * the new list replaces the old one, so it can also remove relationships the
 * request doesn't name: one `delete` without an `entityId` stands for those.
 */
const relationshipFieldOperations = (
  entityConfig: ProxyEntityConfig | undefined,
  entityType: string,
  entityId: string | undefined,
  payload: Record<string, unknown> | undefined,
  write: 'create' | 'update',
  operationIndex: number | undefined,
): RelationshipOperation[] => {
  const config =
    entityConfig && hasOwn(entityConfig, entityType)
      ? entityConfig[entityType]
      : undefined;
  const fields = config?.mutual?.mutualFields;
  if (!payload || !fields) return [];

  const operations: RelationshipOperation[] = [];
  for (const [field, value] of Object.entries(payload)) {
    if (!hasOwn(fields, field)) continue;
    const base = {
      kind: 'relationship' as const,
      byEntityType: entityType,
      byEntityId: entityId,
      entityType: fields[field].entityType,
      ...(operationIndex === undefined ? {} : { operationIndex }),
    };
    const ids = Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string')
      : [];
    for (const id of ids) {
      operations.push({ ...base, action: 'create', entityId: id });
    }
    if (write === 'update') operations.push({ ...base, action: 'delete' });
  }
  return operations;
};

const entityWrite = (
  entityConfig: ProxyEntityConfig | undefined,
  actions: ('create' | 'update')[],
  entityType: string,
  entityId: string | undefined,
  payload: Record<string, unknown> | undefined,
  operationIndex?: number,
): ProxyOperation[] => {
  const index = operationIndex === undefined ? {} : { operationIndex };
  return [
    ...actions.map(
      (action): EntityOperation => ({
        kind: 'entity',
        action,
        entityType,
        ...(entityId === undefined ? {} : { entityId }),
        ...(payload === undefined ? {} : { payload }),
        ...index,
      }),
    ),
    ...relationshipFieldOperations(
      entityConfig,
      entityType,
      entityId,
      payload,
      // An upsert can update, so its relationship fields count as an update's.
      actions.includes('update') ? 'update' : 'create',
      operationIndex,
    ),
  ];
};

const transactionOperations = (
  entityConfig: ProxyEntityConfig | undefined,
  body: unknown,
): ParseResult => {
  const entries = isRecord(body) ? body.operations : undefined;
  if (!Array.isArray(entries)) {
    return invalid('Request body must contain an "operations" array');
  }

  const operations: ProxyOperation[] = [];
  for (const [operationIndex, entry] of entries.entries()) {
    if (!isRecord(entry) || typeof entry.entityType !== 'string') {
      return invalid(`Operation ${operationIndex} has no entityType`);
    }
    const { entityType } = entry;
    const entityId =
      typeof entry.entityId === 'string' ? entry.entityId : undefined;
    const payload = isRecord(entry.payload) ? entry.payload : undefined;

    switch (entry.operation) {
      case 'createEntity':
      case 'updateEntity':
        operations.push(
          ...entityWrite(
            entityConfig,
            [entry.operation === 'createEntity' ? 'create' : 'update'],
            entityType,
            entityId,
            payload,
            operationIndex,
          ),
        );
        break;
      case 'adjustEntity':
        operations.push({
          kind: 'entity',
          action: 'update',
          entityType,
          ...(entityId === undefined ? {} : { entityId }),
          ...(isRecord(entry.adjustments)
            ? { payload: entry.adjustments }
            : {}),
          operationIndex,
        });
        break;
      case 'deleteEntity':
        operations.push({
          kind: 'entity',
          action: 'delete',
          entityType,
          ...(entityId === undefined ? {} : { entityId }),
          operationIndex,
        });
        break;
      case 'createMutual':
      case 'updateMutual':
      case 'deleteMutual': {
        if (
          typeof entry.byEntityType !== 'string' ||
          typeof entry.byEntityId !== 'string'
        ) {
          return invalid(
            `Operation ${operationIndex} needs byEntityType and byEntityId`,
          );
        }
        operations.push({
          kind: 'relationship',
          action:
            entry.operation === 'createMutual'
              ? 'create'
              : entry.operation === 'updateMutual'
                ? 'update'
                : 'delete',
          byEntityType: entry.byEntityType,
          byEntityId: entry.byEntityId,
          entityType,
          ...(entityId === undefined ? {} : { entityId }),
          ...(payload === undefined ? {} : { payload }),
          operationIndex,
        });
        break;
      }
      default:
        return invalid(
          `Operation ${operationIndex} has an unknown operation '${String(entry.operation)}'`,
        );
    }
  }
  return { ok: true, operations };
};

const decode = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
};

/**
 * Describes a request to Monorise Core as operations. `path` is the path
 * under `/core`, e.g. `/entity/order/123`. Paths Core doesn't serve, and the
 * WebSocket ticket route, which stays on its own route with a `full` key,
 * fail with 404 so no request reaches Core unchecked.
 */
export const parseOperations = ({
  method,
  path,
  searchParams,
  body,
  entityConfig,
}: {
  method: string;
  path: string;
  searchParams: URLSearchParams;
  body: unknown;
  entityConfig?: ProxyEntityConfig;
}): ParseResult => {
  // Core's router matches the raw path. A segment that decodes to contain
  // `/`, or an empty one, would be described as a different route than the
  // one Core runs, so neither is accepted.
  const decoded = (path === '/' ? [] : path.split('/').slice(1)).map(decode);
  if (decoded.some((segment) => !segment || segment.includes('/'))) {
    return invalid('Malformed path');
  }
  const [root, ...rest] = decoded as string[];
  const verb = method.toUpperCase();
  const payload = isRecord(body) ? body : undefined;
  const unknown = notFound(`Monorise Core has no route ${verb} ${path}`);
  const one = (operation: ProxyOperation): ParseResult => ({
    ok: true,
    operations: [operation],
  });
  // Present query parameters only, so operations stay comparable.
  const params = (...names: ('query' | 'group' | 'start' | 'end')[]) =>
    Object.fromEntries(
      names.flatMap((name) => {
        const value = searchParams.get(name);
        return value ? [[name, value]] : [];
      }),
    );

  if (root === 'entity') {
    const [entityType, second, third, fourth] = rest;
    if (rest.length === 1 && verb === 'GET') {
      return one({
        kind: 'entity',
        action: 'list',
        entityType,
        ...params('query', 'start', 'end'),
      });
    }
    if (rest.length === 1 && verb === 'POST') {
      const entityId =
        typeof payload?.entityId === 'string' ? payload.entityId : undefined;
      return {
        ok: true,
        operations: entityWrite(
          entityConfig,
          ['create'],
          entityType,
          entityId,
          payload,
        ),
      };
    }
    if (rest.length === 4 && second === 'unique' && verb === 'GET') {
      return one({
        kind: 'entity',
        action: 'get',
        entityType,
        unique: { field: third, value: fourth },
      });
    }
    if (rest.length === 3 && third === 'adjust' && verb === 'POST') {
      return one({
        kind: 'entity',
        action: 'update',
        entityType,
        entityId: second,
        ...(payload === undefined ? {} : { payload }),
      });
    }
    if (rest.length === 2) {
      const write = (actions: ('create' | 'update')[]): ParseResult => ({
        ok: true,
        operations: entityWrite(
          entityConfig,
          actions,
          entityType,
          second,
          payload,
        ),
      });
      if (verb === 'GET') {
        return one({
          kind: 'entity',
          action: 'get',
          entityType,
          entityId: second,
        });
      }
      if (verb === 'PUT') return write(['create', 'update']);
      if (verb === 'PATCH') return write(['update']);
      if (verb === 'DELETE') {
        return one({
          kind: 'entity',
          action: 'delete',
          entityType,
          entityId: second,
        });
      }
    }
    return unknown;
  }

  if (root === 'mutual') {
    const [byEntityType, byEntityId, entityType, entityId] = rest;
    if (rest.length === 3 && verb === 'GET') {
      // A chain query reads every relationship along the chain. Only the
      // first hop's byEntityId is known before Core runs the query.
      const chain = searchParams.get('chainEntityQuery');
      const types = [
        byEntityType,
        ...(chain ? chain.split(',') : []),
        entityType,
      ];
      return {
        ok: true,
        operations: types.slice(1).map(
          (to, hop): RelationshipOperation => ({
            kind: 'relationship',
            action: 'read',
            byEntityType: types[hop],
            ...(hop === 0 ? { byEntityId } : {}),
            entityType: to,
          }),
        ),
      };
    }
    if (rest.length === 4) {
      const action: RelationshipAction | undefined =
        verb === 'GET'
          ? 'read'
          : verb === 'POST'
            ? 'create'
            : verb === 'PATCH'
              ? 'update'
              : verb === 'DELETE'
                ? 'delete'
                : undefined;
      if (action) {
        return one({
          kind: 'relationship',
          action,
          byEntityType,
          byEntityId,
          entityType,
          entityId,
          ...(payload === undefined || action === 'read' || action === 'delete'
            ? {}
            : { payload }),
        });
      }
    }
    return unknown;
  }

  if (root === 'tag' && rest.length === 2 && verb === 'GET') {
    return one({
      kind: 'entity',
      action: 'list',
      entityType: rest[0],
      tag: rest[1],
      ...params('group', 'start', 'end'),
    });
  }

  if (root === 'transaction' && rest.length === 0 && verb === 'POST') {
    return transactionOperations(entityConfig, body);
  }

  if (root === 'app') {
    return one({
      kind: 'route',
      method: verb,
      path: `/${decoded.join('/')}`,
      ...(body === undefined ? {} : { body }),
    });
  }

  return unknown;
};
