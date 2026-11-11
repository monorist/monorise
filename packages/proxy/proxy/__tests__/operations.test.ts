import { describe, expect, it } from 'vitest';
import { setupCommonRoutes } from '../../../core/controllers/setupRoutes';
import { DependencyContainer } from '../../../core/services/DependencyContainer';
import { type ProxyEntityConfig, parseOperations } from '../operations';

const entityConfig: ProxyEntityConfig = {
  learner: {
    mutual: {
      mutualFields: {
        courseIds: { entityType: 'course' },
        cohortIds: { entityType: 'cohort' },
      },
    },
  },
};

const parse = (method: string, url: string, body?: unknown) => {
  const { pathname, searchParams } = new URL(url, 'http://proxy');
  return parseOperations({
    method,
    path: pathname,
    searchParams,
    body,
    entityConfig,
  });
};

const operations = (method: string, url: string, body?: unknown) => {
  const result = parse(method, url, body);
  if (!result.ok) throw new Error(result.message);
  return result.operations;
};

describe('parseOperations: entities', () => {
  it.each<[string, string, unknown, unknown[]]>([
    [
      'GET',
      '/entity/order',
      undefined,
      [{ kind: 'entity', action: 'list', entityType: 'order' }],
    ],
    [
      'GET',
      '/entity/order?query=%20ann%20',
      undefined,
      [{ kind: 'entity', action: 'list', entityType: 'order', query: 'ann' }],
    ],
    [
      'GET',
      '/entity/order/o1',
      undefined,
      [{ kind: 'entity', action: 'get', entityType: 'order', entityId: 'o1' }],
    ],
    [
      'GET',
      '/entity/user/unique/email/a%40b.co',
      undefined,
      [
        {
          kind: 'entity',
          action: 'get',
          entityType: 'user',
          unique: { field: 'email', value: 'a@b.co' },
        },
      ],
    ],
    [
      'GET',
      '/tag/order/region?group=eu',
      undefined,
      [{ kind: 'entity', action: 'list', entityType: 'order', tag: 'region' }],
    ],
    [
      'POST',
      '/entity/order',
      { total: 5, entityId: 'chosen' },
      [
        {
          kind: 'entity',
          action: 'create',
          entityType: 'order',
          entityId: 'chosen',
          payload: { total: 5, entityId: 'chosen' },
        },
      ],
    ],
    [
      'PATCH',
      '/entity/order/o1',
      { status: 'paid' },
      [
        {
          kind: 'entity',
          action: 'update',
          entityType: 'order',
          entityId: 'o1',
          payload: { status: 'paid' },
        },
      ],
    ],
    [
      'POST',
      '/entity/order/o1/adjust',
      { quantity: 1 },
      [
        {
          kind: 'entity',
          action: 'update',
          entityType: 'order',
          entityId: 'o1',
          payload: { quantity: 1 },
        },
      ],
    ],
    [
      'DELETE',
      '/entity/order/o1',
      undefined,
      [
        {
          kind: 'entity',
          action: 'delete',
          entityType: 'order',
          entityId: 'o1',
        },
      ],
    ],
  ])('%s %s', (method, url, body, expected) => {
    expect(operations(method, url, body)).toEqual(expected);
  });

  it('describes an upsert as both a create and an update', () => {
    expect(
      operations('PUT', '/entity/order/o1', { status: 'paid' }).map(
        (operation) => operation.kind === 'entity' && operation.action,
      ),
    ).toEqual(['create', 'update']);
  });
});

describe('parseOperations: relationship fields', () => {
  it('adds a relationship create for each ID in a create payload', () => {
    expect(
      operations('POST', '/entity/learner', {
        name: 'Ann',
        courseIds: ['c1', 'c2'],
      }).slice(1),
    ).toEqual([
      {
        kind: 'relationship',
        action: 'create',
        byEntityType: 'learner',
        byEntityId: undefined,
        entityType: 'course',
        entityId: 'c1',
      },
      {
        kind: 'relationship',
        action: 'create',
        byEntityType: 'learner',
        byEntityId: undefined,
        entityType: 'course',
        entityId: 'c2',
      },
    ]);
  });

  it('adds a delete on update, since the new list replaces the old one', () => {
    expect(
      operations('PATCH', '/entity/learner/l1', { cohortIds: [] }).slice(1),
    ).toEqual([
      {
        kind: 'relationship',
        action: 'delete',
        byEntityType: 'learner',
        byEntityId: 'l1',
        entityType: 'cohort',
      },
    ]);
  });

  it('describes an upsert relationship field once, as an update would', () => {
    const relationships = operations('PUT', '/entity/learner/l1', {
      courseIds: ['c1'],
    }).filter((operation) => operation.kind === 'relationship');

    expect(
      relationships.map(
        (operation) => operation.kind === 'relationship' && operation.action,
      ),
    ).toEqual(['create', 'delete']);
  });

  it('ignores fields that are not relationships, and entity types without a config', () => {
    expect(
      operations('POST', '/entity/order', { courseIds: ['c1'] }),
    ).toHaveLength(1);
  });
});

describe('parseOperations: relationships', () => {
  it.each<[string, string, string]>([
    ['GET', '/mutual/learner/l1/course/c1', 'read'],
    ['POST', '/mutual/learner/l1/course/c1', 'create'],
    ['PATCH', '/mutual/learner/l1/course/c1', 'update'],
    ['DELETE', '/mutual/learner/l1/course/c1', 'delete'],
  ])('%s %s is a relationship %s', (method, url, action) => {
    expect(operations(method, url, { role: 'student' })).toEqual([
      {
        kind: 'relationship',
        action,
        byEntityType: 'learner',
        byEntityId: 'l1',
        entityType: 'course',
        entityId: 'c1',
        ...(action === 'create' || action === 'update'
          ? { payload: { role: 'student' } }
          : {}),
      },
    ]);
  });

  it('describes a listing of related entities as a read without entityId', () => {
    expect(operations('GET', '/mutual/learner/l1/course')).toEqual([
      {
        kind: 'relationship',
        action: 'read',
        byEntityType: 'learner',
        byEntityId: 'l1',
        entityType: 'course',
      },
    ]);
  });

  it('reads every hop of a chain query; only the first knows its byEntityId', () => {
    expect(
      operations(
        'GET',
        '/mutual/learner/l1/video?chainEntityQuery=course,module',
      ),
    ).toEqual([
      {
        kind: 'relationship',
        action: 'read',
        byEntityType: 'learner',
        byEntityId: 'l1',
        entityType: 'course',
      },
      {
        kind: 'relationship',
        action: 'read',
        byEntityType: 'course',
        entityType: 'module',
      },
      {
        kind: 'relationship',
        action: 'read',
        byEntityType: 'module',
        entityType: 'video',
      },
    ]);
  });
});

describe('parseOperations: transactions', () => {
  it('describes every operation, with its index', () => {
    expect(
      operations('POST', '/transaction', {
        operations: [
          {
            operation: 'createEntity',
            entityType: 'learner',
            payload: { courseIds: ['c1'] },
          },
          {
            operation: 'updateEntity',
            entityType: 'order',
            entityId: 'o1',
            payload: { status: 'paid' },
          },
          {
            operation: 'adjustEntity',
            entityType: 'order',
            entityId: 'o1',
            adjustments: { quantity: 1 },
          },
          { operation: 'deleteEntity', entityType: 'order', entityId: 'o2' },
          {
            operation: 'createMutual',
            byEntityType: 'learner',
            byEntityId: 'l1',
            entityType: 'course',
            entityId: 'c1',
            payload: { role: 'student' },
          },
          {
            operation: 'deleteMutual',
            byEntityType: 'learner',
            byEntityId: 'l1',
            entityType: 'course',
            entityId: 'c2',
          },
        ],
      }),
    ).toEqual([
      {
        kind: 'entity',
        action: 'create',
        entityType: 'learner',
        payload: { courseIds: ['c1'] },
        operationIndex: 0,
      },
      {
        kind: 'relationship',
        action: 'create',
        byEntityType: 'learner',
        byEntityId: undefined,
        entityType: 'course',
        entityId: 'c1',
        operationIndex: 0,
      },
      {
        kind: 'entity',
        action: 'update',
        entityType: 'order',
        entityId: 'o1',
        payload: { status: 'paid' },
        operationIndex: 1,
      },
      {
        kind: 'entity',
        action: 'update',
        entityType: 'order',
        entityId: 'o1',
        payload: { quantity: 1 },
        operationIndex: 2,
      },
      {
        kind: 'entity',
        action: 'delete',
        entityType: 'order',
        entityId: 'o2',
        operationIndex: 3,
      },
      {
        kind: 'relationship',
        action: 'create',
        byEntityType: 'learner',
        byEntityId: 'l1',
        entityType: 'course',
        entityId: 'c1',
        payload: { role: 'student' },
        operationIndex: 4,
      },
      {
        kind: 'relationship',
        action: 'delete',
        byEntityType: 'learner',
        byEntityId: 'l1',
        entityType: 'course',
        entityId: 'c2',
        operationIndex: 5,
      },
    ]);
  });

  it.each<[string, unknown, string]>([
    ['a body without operations', {}, 'must contain an "operations" array'],
    [
      'an operation without entityType',
      { operations: [{ operation: 'deleteEntity' }] },
      'Operation 0 has no entityType',
    ],
    [
      'an unknown operation',
      { operations: [{ operation: 'dropTable', entityType: 'order' }] },
      "unknown operation 'dropTable'",
    ],
    [
      'a mutual operation without byEntityId',
      {
        operations: [
          {
            operation: 'createMutual',
            entityType: 'course',
            byEntityType: 'learner',
          },
        ],
      },
      'needs byEntityType and byEntityId',
    ],
  ])('rejects %s with 400', (_, body, message) => {
    const result = parse('POST', '/transaction', body);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.status).toBe(400);
    expect(!result.ok && result.message).toContain(message);
  });
});

describe('parseOperations: custom routes and unknown paths', () => {
  it('describes /app/... as a route operation', () => {
    expect(
      operations('POST', '/app/invite-casting', { hirerId: 'h1' }),
    ).toEqual([
      {
        kind: 'route',
        method: 'POST',
        path: '/app/invite-casting',
        body: { hirerId: 'h1' },
      },
    ]);
  });

  it.each<[string, string]>([
    ['GET', '/nope'],
    ['POST', '/ws/ticket/learner/l1'],
    ['PATCH', '/entity/order'],
    ['GET', '/entity/order/o1/extra'],
    ['PUT', '/mutual/learner/l1/course/c1'],
  ])('answers 404 to %s %s', (method, url) => {
    const result = parse(method, url);

    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('answers 400 to a path that does not decode', () => {
    expect(parse('GET', '/entity/%E0%A4%A')).toMatchObject({
      ok: false,
      status: 400,
    });
  });
});

describe('parseOperations: every Core route', () => {
  // Every route the built-in API serves must parse, so a route added to Core
  // without parser support fails here instead of being unreachable or
  // unchecked. Only the WebSocket ticket route is deliberately not proxied.
  const routes = setupCommonRoutes(
    new DependencyContainer({
      // biome-ignore lint/suspicious/noExplicitAny: no entity configs are needed to list routes
      EntityConfig: {} as any,
      AllowedEntityTypes: [],
      EmailAuthEnabledEntities: [],
    }),
  ).routes.filter((route) => route.method !== 'ALL');

  const unique = [
    ...new Set(routes.map((route) => `${route.method} ${route.path}`)),
  ];

  it.each(unique)('%s', (route) => {
    const [method, pattern] = route.split(' ');
    const path = pattern.replace(/:[^/]+/g, 'x');
    const result = parse(
      method,
      path,
      method === 'POST' && path === '/transaction'
        ? { operations: [] }
        : undefined,
    );

    if (path.startsWith('/ws/ticket/')) {
      expect(result).toMatchObject({ ok: false, status: 404 });
    } else {
      expect(result.ok).toBe(true);
    }
  });
});
