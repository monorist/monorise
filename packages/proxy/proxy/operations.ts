/**
 * A request to Monorise Core, described as the operations rules are written
 * against: one per thing it reads or writes. Rules on operations rather than
 * URLs can't be bypassed by a different request shape: a transaction's
 * `deleteEntity` and a `DELETE /entity/...` are the same operation.
 */

import type { ApiKeyMutualDataFields, EntitySchemaMap } from '@monorise/base';

/**
 * `adjust` adds an amount to numeric fields (`POST /entity/:type/:id/adjust`).
 * API key policies count it as an update; rules keep it apart, so a rule
 * written for the values an update sets never approves an adjust.
 */
export type EntityAction =
  | 'get'
  | 'list'
  | 'create'
  | 'update'
  | 'adjust'
  | 'delete';

/** Relationships have a single `read`: their listings are bounded by `byEntityId`. */
export type RelationshipAction = 'read' | 'create' | 'update' | 'delete';

/**
 * An entity's fields, from the generated `EntitySchemaMap`. Rules see the
 * payload before Core validates it, so every field may be missing.
 */
export type EntityPayload<T extends string = string> = string extends T
  ? Record<string, unknown>
  : T extends keyof EntitySchemaMap
    ? Partial<EntitySchemaMap[T]>
    : Record<string, unknown>;

/** An entity's numeric fields: what an `adjust` adds amounts to. */
export type EntityAdjustments<T extends string = string> = string extends T
  ? Record<string, number>
  : T extends keyof EntitySchemaMap
    ? {
        [K in keyof EntitySchemaMap[T] as NonNullable<
          EntitySchemaMap[T][K]
        > extends number
          ? K
          : never]?: number;
      }
    : Record<string, number>;

type MutualDataField<
  By extends string,
  To extends string,
> = By extends keyof ApiKeyMutualDataFields
  ? To extends keyof ApiKeyMutualDataFields[By]
    ? Extract<ApiKeyMutualDataFields[By][To], string>
    : string
  : string;

/** A relationship's `mutualData`, with the field names the generated config declares. */
export type MutualDataPayload<
  By extends string = string,
  To extends string = string,
> = { [K in MutualDataField<By, To>]?: unknown };

export type EntityOperation<
  T extends string = string,
  A extends EntityAction = EntityAction,
> = {
  kind: 'entity';
  action: A;
  entityType: T;
  entityId?: string;
  /** The fields a `create` or `update` sets. */
  payload?: A extends 'adjust' ? never : EntityPayload<T>;
  /**
   * The named condition an `update` or `adjust` must meet: the body's
   * `$condition`, or a transaction entry's `condition`.
   */
  condition?: string;
  /** The amount an `adjust` adds to each numeric field. */
  adjustments?: 'adjust' extends A ? EntityAdjustments<T> : never;
  /**
   * The relationship this entity materializes, when creating the relationship
   * also creates it (`asEntity`).
   */
  asEntityOf?: Pick<
    RelationshipOperation,
    'byEntityType' | 'byEntityId' | 'entityType' | 'entityId'
  >;
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

export type RelationshipOperation<
  By extends string = string,
  To extends string = string,
  A extends RelationshipAction = RelationshipAction,
> = {
  kind: 'relationship';
  action: A;
  byEntityType: By;
  /**
   * Absent for a relationship field on an entity created without an ID, and
   * for every hop of a chain query after the first.
   */
  byEntityId?: string;
  entityType: To;
  /** Absent when listing, and for the relationships an update's new list removes. */
  entityId?: string;
  payload?: MutualDataPayload<By, To>;
  operationIndex?: number;
};

export type RouteOperation = {
  kind: 'route';
  method: string;
  /** The path under `/core`, e.g. `/app/invite-casting`. */
  path: string;
  body?: unknown;
  /** Segments the matching route rule's `:param`s captured. */
  params?: Record<string, string>;
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
 * each entity are relationships, to which entity type, and which
 * relationships materialize an entity (`asEntity`).
 */
export type ProxyEntityConfig = Record<
  string,
  {
    mutual?: {
      mutualFields?: Record<
        string,
        { entityType: string; mutual?: { asEntity?: { name: string } } }
      >;
    };
  }
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

// The entity type a relationship materializes (`asEntity`). Its mutual
// config can sit on either side, as in Core.
const asEntityType = (
  entityConfig: ProxyEntityConfig | undefined,
  byEntityType: string,
  entityType: string,
) => {
  const declared = (from: string, to: string) => {
    const fields =
      entityConfig && hasOwn(entityConfig, from)
        ? entityConfig[from].mutual?.mutualFields
        : undefined;
    return Object.values(fields ?? {}).find(
      (field) => field.entityType === to && field.mutual,
    )?.mutual?.asEntity?.name;
  };
  return (
    declared(byEntityType, entityType) ?? declared(entityType, byEntityType)
  );
};

/**
 * A relationship create, followed by a create of the entity it materializes
 * when it has an `asEntity`: the relationship's `mutualData` becomes that
 * entity's data. `requestedAsEntity` is one the request names, which wins
 * over the config's. Updates and deletes reach that entity by replication,
 * so only the create is described.
 */
const relationshipCreate = (
  entityConfig: ProxyEntityConfig | undefined,
  relationship: RelationshipOperation,
  requestedAsEntity?: string,
): ProxyOperation[] => {
  const { byEntityType, byEntityId, entityType, entityId, payload } =
    relationship;
  const asEntity =
    requestedAsEntity || asEntityType(entityConfig, byEntityType, entityType);
  if (!asEntity) return [relationship];
  return [
    relationship,
    {
      kind: 'entity',
      action: 'create',
      entityType: asEntity,
      ...(payload === undefined ? {} : { payload }),
      asEntityOf: { byEntityType, byEntityId, entityType, entityId },
      ...(relationship.operationIndex === undefined
        ? {}
        : { operationIndex: relationship.operationIndex }),
    },
  ];
};

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
): ProxyOperation[] => {
  const config =
    entityConfig && hasOwn(entityConfig, entityType)
      ? entityConfig[entityType]
      : undefined;
  const fields = config?.mutual?.mutualFields;
  if (!payload || !fields) return [];

  const operations: ProxyOperation[] = [];
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
      operations.push(
        ...relationshipCreate(entityConfig, {
          ...base,
          action: 'create',
          entityId: id,
        }),
      );
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
  condition?: string,
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
        ...(condition === undefined ? {} : { condition }),
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
    const condition =
      typeof entry.condition === 'string' ? entry.condition : undefined;

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
            condition,
          ),
        );
        break;
      case 'adjustEntity':
        operations.push({
          kind: 'entity',
          action: 'adjust',
          entityType,
          ...(entityId === undefined ? {} : { entityId }),
          ...(isRecord(entry.adjustments)
            ? { adjustments: entry.adjustments as Record<string, number> }
            : {}),
          ...(condition === undefined ? {} : { condition }),
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
        const relationship: RelationshipOperation = {
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
        };
        // A transaction's createMutual uses only the config's asEntity.
        operations.push(
          ...(relationship.action === 'create'
            ? relationshipCreate(entityConfig, relationship)
            : [relationship]),
        );
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
      // As AdjustEntityController reads the body.
      const { $condition: condition, ...adjustments } = payload ?? {};
      return one({
        kind: 'entity',
        action: 'adjust',
        entityType,
        entityId: second,
        ...(payload === undefined
          ? {}
          : { adjustments: adjustments as Record<string, number> }),
        ...(typeof condition === 'string' ? { condition } : {}),
      });
    }
    if (rest.length === 2) {
      const write = (
        actions: ('create' | 'update')[],
        data = payload,
        condition?: string,
      ): ParseResult => ({
        ok: true,
        operations: entityWrite(
          entityConfig,
          actions,
          entityType,
          second,
          data,
          undefined,
          condition,
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
      if (verb === 'PATCH') {
        // As UpdateEntityController reads the body: these aren't data.
        if (payload === undefined) return write(['update']);
        const { $condition: condition, $where: _, ...data } = payload;
        return write(
          ['update'],
          data,
          typeof condition === 'string' ? condition : undefined,
        );
      }
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
        const relationship: RelationshipOperation = {
          kind: 'relationship',
          action,
          byEntityType,
          byEntityId,
          entityType,
          entityId,
          ...(payload === undefined || action === 'read' || action === 'delete'
            ? {}
            : { payload }),
        };
        return {
          ok: true,
          operations:
            action === 'create'
              ? // CreateMutualController passes ?asEntity= to the service.
                relationshipCreate(
                  entityConfig,
                  relationship,
                  searchParams.get('asEntity') ?? undefined,
                )
              : [relationship],
        };
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
