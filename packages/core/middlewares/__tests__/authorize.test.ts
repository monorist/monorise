import type { ApiKeyPolicies } from '@monorise/base';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { setupCommonRoutes } from '../../controllers/setupRoutes';
import { DependencyContainer } from '../../services/DependencyContainer';
import { createApiKeyAuth, parseApiKeys } from '../api-key-auth';
import {
  customRouteGate,
  requireEntity,
  requireFullPolicy,
  requireMutualTypes,
  requireTransactionOperations,
  requires,
  routeGuardRequirement,
} from '../authorize';

const policies: ApiKeyPolicies = {
  reader: { entities: { course: 'read', learner: { read: ['name'] } } },
  editor: {
    entities: {
      course: { read: '*', create: ['title'], update: ['title'] },
      learner: { update: ['name'] },
    },
  },
};

const API_KEYS = JSON.stringify({
  full: ['full-key'],
  reader: ['reader-key'],
  editor: ['editor-key'],
});

// The guards under test on the same paths setupCommonRoutes uses, in front of
// a stub handler, so nothing reaches DynamoDB.
const app = new Hono();
app.use(
  createApiKeyAuth(
    parseApiKeys(API_KEYS, ['full', ...Object.keys(policies)]),
    policies,
  ),
);
const ok = (c: { json: (body: unknown) => Response }) => c.json({ ok: true });
app.get('/entity/:entityType', requireEntity('read'), ok);
app.post('/entity/:entityType', requireEntity('create'), ok);
app.put('/entity/:entityType/:entityId', requireEntity('create', 'update'), ok);
app.delete('/entity/:entityType/:entityId', requireEntity('delete'), ok);
app.get(
  '/mutual/:byEntityType/:byEntityId/:entityType',
  requireMutualTypes(),
  ok,
);
app.post('/ws/ticket/:entityType/:entityId', requireFullPolicy(), ok);
app.post('/transaction', requireTransactionOperations(), async (c) => {
  // Like the real controller: it reads the body the guard already parsed,
  // and answers 400 to a body that isn't JSON.
  try {
    return c.json({
      ok: true,
      operations: (await c.req.json()).operations.length,
    });
  } catch {
    c.status(400);
    return c.json({ code: 'API_VALIDATION_ERROR' });
  }
});

const call = async (
  key: string,
  method: string,
  path: string,
  body?: unknown,
) => {
  const res = await app.request(path, {
    method,
    headers: { 'x-api-key': key, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

describe('requireEntity', () => {
  it('lets the full policy through without checking', async () => {
    expect(
      (await call('full-key', 'DELETE', '/entity/anything/1')).status,
    ).toBe(200);
  });

  it('answers 404 for a type the policy does not list', async () => {
    expect(await call('reader-key', 'GET', '/entity/payment')).toEqual({
      status: 404,
      body: { code: 'NOT_FOUND' },
    });
  });

  it('answers 403 for a listed type without the action', async () => {
    expect(await call('reader-key', 'POST', '/entity/course')).toEqual({
      status: 403,
      body: {
        code: 'FORBIDDEN',
        message: "API key policy 'reader' does not allow create on 'course'",
      },
    });
  });

  it('allows a granted action', async () => {
    expect((await call('reader-key', 'GET', '/entity/course')).status).toBe(
      200,
    );
    expect((await call('editor-key', 'POST', '/entity/course')).status).toBe(
      200,
    );
  });

  it('allows read when a write list grants it', async () => {
    expect((await call('editor-key', 'GET', '/entity/learner')).status).toBe(
      200,
    );
  });

  it('requires every listed action, as upsert does', async () => {
    expect((await call('editor-key', 'PUT', '/entity/course/1')).status).toBe(
      200,
    );
    const learner = await call('editor-key', 'PUT', '/entity/learner/1');
    expect(learner.status).toBe(403);
    expect(learner.body.message).toContain('does not allow create');
  });

  it('lets a request through when no API key was resolved', async () => {
    const bare = new Hono();
    bare.get('/entity/:entityType', requireEntity('delete'), ok);

    expect((await bare.request('/entity/course')).status).toBe(200);
  });
});

describe('requireMutualTypes', () => {
  it('answers 404 when either type is unlisted', async () => {
    expect(
      (await call('reader-key', 'GET', '/mutual/course/1/payment')).status,
    ).toBe(404);
    expect(
      (await call('reader-key', 'GET', '/mutual/payment/1/course')).status,
    ).toBe(404);
  });

  it('allows the route when both types are listed', async () => {
    expect(
      (await call('reader-key', 'GET', '/mutual/course/1/learner')).status,
    ).toBe(200);
  });
});

describe('requireFullPolicy', () => {
  it('answers 403 to any other policy', async () => {
    expect(await call('reader-key', 'POST', '/ws/ticket/course/1')).toEqual({
      status: 403,
      body: {
        code: 'FORBIDDEN',
        message:
          "API key policy 'reader' cannot call this route; only 'full' can",
      },
    });
  });

  it('allows the full policy', async () => {
    expect((await call('full-key', 'POST', '/ws/ticket/course/1')).status).toBe(
      200,
    );
  });
});

describe('requireTransactionOperations', () => {
  it('allows a transaction whose every operation is granted', async () => {
    const res = await call('editor-key', 'POST', '/transaction', {
      operations: [
        { operation: 'createEntity', entityType: 'course', payload: {} },
        { operation: 'updateEntity', entityType: 'learner', entityId: '1' },
        { operation: 'adjustEntity', entityType: 'course', entityId: '1' },
      ],
    });

    expect(res).toEqual({ status: 200, body: { ok: true, operations: 3 } });
  });

  it('rejects the whole transaction for one forbidden operation, with its index', async () => {
    const res = await call('editor-key', 'POST', '/transaction', {
      operations: [
        { operation: 'updateEntity', entityType: 'course', entityId: '1' },
        { operation: 'deleteEntity', entityType: 'course', entityId: '1' },
      ],
    });

    expect(res).toEqual({
      status: 403,
      body: {
        code: 'FORBIDDEN',
        message: "API key policy 'editor' does not allow delete on 'course'",
        operationIndex: 1,
      },
    });
  });

  it('answers 404 with the index for an operation on an unlisted type', async () => {
    const res = await call('editor-key', 'POST', '/transaction', {
      operations: [
        { operation: 'createEntity', entityType: 'course', payload: {} },
        {
          operation: 'createMutual',
          byEntityType: 'course',
          byEntityId: '1',
          entityType: 'payment',
          entityId: '2',
        },
      ],
    });

    expect(res).toEqual({
      status: 404,
      body: { code: 'NOT_FOUND', operationIndex: 1 },
    });
  });

  it('passes a malformed body through for the controller to reject', async () => {
    const res = await app.request('/transaction', {
      method: 'POST',
      headers: { 'x-api-key': 'editor-key' },
      body: 'not json',
    });

    expect(res.status).toBe(400);
  });
});

describe('setupCommonRoutes', () => {
  const routes = setupCommonRoutes(
    new DependencyContainer({
      // biome-ignore lint/suspicious/noExplicitAny: no entity configs are needed to list routes
      EntityConfig: {} as any,
      AllowedEntityTypes: [],
      EmailAuthEnabledEntities: [],
    }),
  ).routes.filter((route) => route.method !== 'ALL');

  const requirements = new Map<string, (string | undefined)[]>();
  for (const route of routes) {
    const key = `${route.method} ${route.path}`;
    requirements.set(key, [
      ...(requirements.get(key) ?? []),
      routeGuardRequirement(route.handler),
    ]);
  }

  it('gives every route exactly one guard, so a new route cannot ship unguarded', () => {
    const unguarded = [...requirements].filter(
      ([, handlers]) => handlers.filter(Boolean).length !== 1,
    );

    expect(unguarded).toEqual([]);
  });

  it('guards each route with the intended requirement', () => {
    expect(
      Object.fromEntries(
        [...requirements].map(([route, handlers]) => [
          route,
          handlers.find(Boolean),
        ]),
      ),
    ).toEqual({
      'GET /mutual/:byEntityType/:byEntityId/:entityType': 'mutual:types',
      'POST /mutual/:byEntityType/:byEntityId/:entityType/:entityId':
        'mutual:types',
      'GET /mutual/:byEntityType/:byEntityId/:entityType/:entityId':
        'mutual:types',
      'PATCH /mutual/:byEntityType/:byEntityId/:entityType/:entityId':
        'mutual:types',
      'DELETE /mutual/:byEntityType/:byEntityId/:entityType/:entityId':
        'mutual:types',
      'GET /entity/:entityType': 'entity:read',
      'POST /entity/:entityType': 'entity:create',
      'GET /entity/:entityType/unique/:uniqueField/:uniqueFieldValue':
        'entity:read',
      'POST /entity/:entityType/:entityId/adjust': 'entity:update',
      'GET /entity/:entityType/:entityId': 'entity:read',
      'PUT /entity/:entityType/:entityId': 'entity:create+update',
      'PATCH /entity/:entityType/:entityId': 'entity:update',
      'DELETE /entity/:entityType/:entityId': 'entity:delete',
      'GET /tag/:entityType/:tagName': 'entity:read',
      'POST /transaction': 'transaction',
      'POST /ws/ticket/:entityType/:entityId': 'full',
    });
  });
});

describe('custom route permissions', () => {
  const customPolicies: ApiKeyPolicies = {
    client: {
      entities: { order: { read: ['total'], update: ['status'] } },
      routes: ['checkout'],
    },
    support: { entities: { '*': 'read' }, routes: ['reports'] },
  };

  const routes = new Hono();
  routes.post('/checkout', requires('checkout'), (c) =>
    c.json({ discount: c.get('apiKey')?.has('checkout:discount') ?? null }),
  );
  routes.use('/reports/*', requires('reports'));
  routes.get('/reports/sales', ok);
  routes.get('/health', ok);

  const customApp = new Hono().basePath('/core');
  customApp.use(
    createApiKeyAuth(
      parseApiKeys(
        JSON.stringify({
          full: ['full-key'],
          client: ['client-key'],
          support: ['support-key'],
        }),
        ['full', ...Object.keys(customPolicies)],
      ),
      customPolicies,
    ),
  );
  customApp.use('/app/*', customRouteGate());
  customApp.route('/app', routes);

  const status = async (key: string, method: string, path: string) =>
    (
      await customApp.request(path, {
        method,
        headers: { 'x-api-key': key },
      })
    ).status;

  it('lets a policy call a route whose permission it grants', async () => {
    expect(await status('client-key', 'POST', '/core/app/checkout')).toBe(200);
  });

  it('answers 403 when the policy does not grant the permission', async () => {
    const res = await customApp.request('/core/app/checkout', {
      method: 'POST',
      headers: { 'x-api-key': 'support-key' },
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      code: 'FORBIDDEN',
      message: "API key policy 'support' does not grant 'checkout'",
    });
  });

  it('applies requires() set on a group of routes', async () => {
    expect(await status('support-key', 'GET', '/core/app/reports/sales')).toBe(
      200,
    );
    expect(await status('client-key', 'GET', '/core/app/reports/sales')).toBe(
      403,
    );
  });

  it('keeps a route without requires() to full keys', async () => {
    const res = await customApp.request('/core/app/health', {
      headers: { 'x-api-key': 'client-key' },
    });

    expect(res.status).toBe(403);
    expect((await res.json()).message).toContain('declares no permission');
    expect(await status('full-key', 'GET', '/core/app/health')).toBe(200);
  });

  it('lets full keys call every custom route', async () => {
    const res = await customApp.request('/core/app/checkout', {
      method: 'POST',
      headers: { 'x-api-key': 'full-key' },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ discount: true });
  });

  it('exposes can() and has() on the resolved key', async () => {
    const inspect = new Hono();
    inspect.use(
      createApiKeyAuth(
        parseApiKeys('{"client": ["client-key"]}', ['client']),
        customPolicies,
      ),
    );
    inspect.get('/', (c) => {
      const key = c.get('apiKey');
      return c.json({
        readOrder: key.can('read', 'order'),
        readTotal: key.can('read', 'order', ['total']),
        readStatus: key.can('read', 'order', ['status']),
        readCost: key.can('read', 'order', ['total', 'cost']),
        updateStatus: key.can('update', 'order', ['status']),
        createOrder: key.can('create', 'order'),
        deleteOrder: key.can('delete', 'order'),
        readPayment: key.can('read', 'payment'),
        checkout: key.has('checkout'),
        reports: key.has('reports'),
      });
    });

    const res = await inspect.request('/', {
      headers: { 'x-api-key': 'client-key' },
    });

    expect(await res.json()).toEqual({
      readOrder: true,
      readTotal: true,
      readStatus: true,
      readCost: false,
      updateStatus: true,
      createOrder: false,
      deleteOrder: false,
      readPayment: false,
      checkout: true,
      reports: false,
    });
  });
});
