import type { ApiKeyPolicies } from '@monorise/base';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  type Entity as EntityType,
  createEntityConfig,
  createMutualConfig,
} from '../../../base';
import { setupCommonRoutes } from '../../controllers/setupRoutes';
import { DependencyContainer } from '../../services/DependencyContainer';
import { createApiKeyAuth, parseApiKeys } from '../api-key-auth';
import {
  createRouteGuards,
  customRouteGate,
  requireFullPolicy,
  requires,
  routeGuardRequirement,
} from '../authorize';

const as = (name: string) => name as unknown as EntityType;
const named = (name: string) =>
  createEntityConfig({
    name,
    displayName: name,
    baseSchema: z.object({ name: z.string() }).partial(),
  });

const enrollment = named('enrollment');
const entityConfig = {
  learner: createEntityConfig({
    name: 'learner',
    displayName: 'Learner',
    baseSchema: z.object({ name: z.string() }).partial(),
    mutual: {
      mutualSchema: z
        .object({
          courseIds: z.string().array(),
          cohortIds: z.string().array(),
        })
        .partial(),
      mutualFields: {
        courseIds: { entityType: as('course') },
        cohortIds: {
          entityType: as('cohort'),
          mutual: createMutualConfig({
            entities: [as('learner'), as('cohort')],
            asEntity: enrollment,
          }),
        },
      },
    },
  }),
  course: named('course'),
  module: named('module'),
  cohort: named('cohort'),
  enrollment,
};

const policies: ApiKeyPolicies = {
  reader: { entities: { course: 'read', learner: { read: ['name'] } } },
  editor: {
    entities: {
      course: { read: '*', create: ['title', '$entityId'], update: ['title'] },
      learner: { update: ['name'] },
    },
  },
  writer: {
    entities: {
      order: {
        read: ['total', 'status', 'notes'],
        create: ['customerId', 'items', 'notes'],
        update: ['status', 'notes', 'quantity'],
      },
      invoice: { create: '*', update: ['notes'] },
      learner: {
        read: '*',
        mutuals: { course: { read: '*', create: ['role'], update: ['role'] } },
      },
      course: 'read',
    },
  },
  client: {
    entities: {
      learner: {
        read: '*',
        create: ['name'],
        update: ['name'],
        mutuals: { course: { read: '*', create: ['role'], delete: true } },
      },
      course: { read: '*', mutuals: { module: 'read' } },
      module: 'read',
      cohort: 'read',
    },
  },
  enroller: {
    entities: {
      learner: { read: '*', mutuals: { cohort: 'write' } },
      cohort: 'read',
      enrollment: 'write',
    },
  },
  'enroller-without-enrollment': {
    entities: {
      learner: { read: '*', mutuals: { cohort: 'write' } },
      cohort: 'read',
      enrollment: 'read',
    },
  },
};

const API_KEYS = JSON.stringify({
  full: ['full-key'],
  reader: ['reader-key'],
  editor: ['editor-key'],
  client: ['client-key'],
  writer: ['writer-key'],
  enroller: ['enroller-key'],
  'enroller-without-enrollment': ['enroller-without-enrollment-key'],
});

const guard = createRouteGuards(entityConfig);

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
app.get('/entity/:entityType', guard.entity('read'), ok);
app.post('/entity/:entityType', guard.entity('create'), ok);
app.put('/entity/:entityType/:entityId', guard.entity('upsert'), ok);
app.post('/entity/:entityType/:entityId/adjust', guard.entity('adjust'), ok);
app.patch('/entity/:entityType/:entityId', guard.entity('update'), ok);
app.delete('/entity/:entityType/:entityId', guard.entity('delete'), ok);
app.get(
  '/mutual/:byEntityType/:byEntityId/:entityType',
  guard.mutual('read'),
  ok,
);
const mutualPath = '/mutual/:byEntityType/:byEntityId/:entityType/:entityId';
app.get(mutualPath, guard.mutual('read'), ok);
app.post(mutualPath, guard.mutual('create'), ok);
app.patch(mutualPath, guard.mutual('update'), ok);
app.delete(mutualPath, guard.mutual('delete'), ok);
app.post('/ws/ticket/:entityType/:entityId', requireFullPolicy(), ok);
app.post('/transaction', guard.transaction(), async (c) => {
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

describe('entity guard', () => {
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
    bare.get('/entity/:entityType', guard.entity('delete'), ok);

    expect((await bare.request('/entity/course')).status).toBe(200);
  });
});

describe('mutual guard: listed types', () => {
  it('answers 404 when either type is unlisted', async () => {
    expect(
      (await call('reader-key', 'GET', '/mutual/course/1/payment')).status,
    ).toBe(404);
    expect(
      (await call('reader-key', 'GET', '/mutual/payment/1/course')).status,
    ).toBe(404);
  });

  it("allows the route when the first type's default grants the direction", async () => {
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

describe('transaction guard', () => {
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
      'GET /mutual/:byEntityType/:byEntityId/:entityType': 'mutual:read',
      'POST /mutual/:byEntityType/:byEntityId/:entityType/:entityId':
        'mutual:create',
      'GET /mutual/:byEntityType/:byEntityId/:entityType/:entityId':
        'mutual:read',
      'PATCH /mutual/:byEntityType/:byEntityId/:entityType/:entityId':
        'mutual:update',
      'DELETE /mutual/:byEntityType/:byEntityId/:entityType/:entityId':
        'mutual:delete',
      'GET /entity/:entityType': 'entity:read',
      'POST /entity/:entityType': 'entity:create',
      'GET /entity/:entityType/unique/:uniqueField/:uniqueFieldValue':
        'entity:read',
      'POST /entity/:entityType/:entityId/adjust': 'entity:adjust',
      'GET /entity/:entityType/:entityId': 'entity:read',
      'PUT /entity/:entityType/:entityId': 'entity:upsert',
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

describe('relationship directions', () => {
  it('reads and writes the direction the URL names, as its entry grants', async () => {
    expect(
      (await call('client-key', 'GET', '/mutual/learner/1/course')).status,
    ).toBe(200);
    expect(
      (await call('client-key', 'POST', '/mutual/learner/1/course/9')).status,
    ).toBe(200);
    expect(
      (await call('client-key', 'DELETE', '/mutual/learner/1/course/9')).status,
    ).toBe(200);
    expect(
      await call('client-key', 'PATCH', '/mutual/learner/1/course/9'),
    ).toEqual({
      status: 403,
      body: {
        code: 'FORBIDDEN',
        message:
          "API key policy 'client' does not allow update on learner→course",
      },
    });
  });

  it('never applies an entry to the opposite direction', async () => {
    // course is an object with no learner entry and no '*', so course→learner is closed,
    // even though POST would form the same relationship as learner→course.
    expect(await call('client-key', 'GET', '/mutual/course/9/learner')).toEqual(
      {
        status: 403,
        body: {
          code: 'FORBIDDEN',
          message:
            "API key policy 'client' does not allow read on course→learner",
        },
      },
    );
    expect(
      (await call('client-key', 'POST', '/mutual/course/9/learner/1')).status,
    ).toBe(403);
  });

  it('checks every hop of a chain query', async () => {
    expect(
      (
        await call(
          'client-key',
          'GET',
          '/mutual/learner/1/module?chainEntityQuery=course',
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          'client-key',
          'GET',
          '/mutual/learner/1/course?chainEntityQuery=cohort',
        )
      ).body,
    ).toEqual({
      code: 'FORBIDDEN',
      message: "API key policy 'client' does not allow read on learner→cohort",
    });
    expect(
      (
        await call(
          'client-key',
          'GET',
          '/mutual/learner/1/course?chainEntityQuery=payment',
        )
      ).status,
    ).toBe(404);
  });

  it('checks relationship fields in a create body as create on their direction', async () => {
    expect(
      (
        await call('client-key', 'POST', '/entity/learner', {
          name: 'a',
          courseIds: ['9'],
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call('client-key', 'POST', '/entity/learner', {
          name: 'a',
          cohortIds: ['2'],
        })
      ).body,
    ).toEqual({
      code: 'FORBIDDEN',
      message:
        "API key policy 'client' does not allow create on learner→cohort",
    });
  });

  it('checks relationship fields in an update body as create and delete, since the list replaces the old one', async () => {
    expect(
      (
        await call('client-key', 'PATCH', '/entity/learner/1', {
          courseIds: ['9'],
        })
      ).status,
    ).toBe(200);

    const withoutDelete: ApiKeyPolicies = {
      p: {
        entities: {
          learner: { update: ['name'], mutuals: { course: { create: '*' } } },
          course: 'read',
        },
      },
    };
    const strict = new Hono();
    strict.use(
      createApiKeyAuth(parseApiKeys('{"p": ["k"]}', ['p']), withoutDelete),
    );
    strict.patch('/entity/:entityType/:entityId', guard.entity('update'), ok);

    const res = await strict.request('/entity/learner/1', {
      method: 'PATCH',
      headers: { 'x-api-key': 'k', 'content-type': 'application/json' },
      body: JSON.stringify({ courseIds: ['9'] }),
    });
    expect(await res.json()).toEqual({
      code: 'FORBIDDEN',
      message: "API key policy 'p' does not allow delete on learner→course",
    });
  });

  it('requires create on the asEntity type a relationship creates', async () => {
    expect(
      (await call('enroller-key', 'POST', '/mutual/learner/1/cohort/2')).status,
    ).toBe(200);
    expect(
      await call(
        'enroller-without-enrollment-key',
        'POST',
        '/mutual/learner/1/cohort/2',
      ),
    ).toEqual({
      status: 403,
      body: {
        code: 'FORBIDDEN',
        message:
          "API key policy 'enroller-without-enrollment' does not allow create on 'enrollment', which learner→cohort creates",
      },
    });
  });

  it('checks mutual operations and relationship fields in a transaction', async () => {
    const run = (operations: unknown[]) =>
      call('client-key', 'POST', '/transaction', { operations });

    expect(
      (
        await run([
          {
            operation: 'createMutual',
            byEntityType: 'learner',
            byEntityId: '1',
            entityType: 'course',
            entityId: '9',
          },
          {
            operation: 'deleteMutual',
            byEntityType: 'learner',
            byEntityId: '1',
            entityType: 'course',
            entityId: '8',
          },
        ])
      ).status,
    ).toBe(200);
    expect(
      await run([
        {
          operation: 'createMutual',
          byEntityType: 'learner',
          byEntityId: '1',
          entityType: 'course',
          entityId: '9',
        },
        {
          operation: 'createMutual',
          byEntityType: 'course',
          byEntityId: '9',
          entityType: 'learner',
          entityId: '1',
        },
      ]),
    ).toEqual({
      status: 403,
      body: {
        code: 'FORBIDDEN',
        message:
          "API key policy 'client' does not allow create on course→learner",
        operationIndex: 1,
      },
    });
    expect(
      (
        await run([
          {
            operation: 'updateEntity',
            entityType: 'learner',
            entityId: '1',
            payload: { cohortIds: ['2'] },
          },
        ])
      ).body,
    ).toEqual({
      code: 'FORBIDDEN',
      message:
        "API key policy 'client' does not allow create on learner→cohort",
      operationIndex: 0,
    });
  });
});

describe('field-level write', () => {
  const write = (method: string, path: string, body: unknown) =>
    call('writer-key', method, path, body);

  it('allows a create that sets only fields in the create list', async () => {
    expect(
      (await write('POST', '/entity/order', { customerId: 'c', items: [] }))
        .status,
    ).toBe(200);
  });

  it('rejects a create that sets a field outside the list, naming it', async () => {
    expect(
      await write('POST', '/entity/order', {
        customerId: 'c',
        items: [],
        cost: 5,
      }),
    ).toEqual({
      status: 403,
      body: {
        code: 'FORBIDDEN_FIELDS',
        message:
          "API key policy 'writer' does not allow create on these fields of 'order': 'cost'",
        fields: ['cost'],
      },
    });
  });

  it('treats entityId and createdAt in a create body as $entityId and $createdAt', async () => {
    const res = await write('POST', '/entity/order', {
      customerId: 'c',
      entityId: 'chosen',
      createdAt: '2020-01-01T00:00:00Z',
    });

    expect(res.body.fields).toEqual(['$entityId', '$createdAt']);
    expect(
      (
        await write('POST', '/entity/invoice', {
          entityId: 'chosen',
          createdAt: '2020-01-01T00:00:00Z',
        })
      ).status,
    ).toBe(200);
  });

  it('checks an update against the update list, ignoring $condition', async () => {
    expect(
      (
        await write('PATCH', '/entity/order/1', {
          status: 'paid',
          $condition: 'unpaid',
        })
      ).status,
    ).toBe(200);
    expect(
      (await write('PATCH', '/entity/order/1', { total: 5 })).body.fields,
    ).toEqual(['total']);
  });

  it('requires read on every field a legacy $where names', async () => {
    expect(
      (
        await write('PATCH', '/entity/order/1', {
          notes: 'x',
          $where: { status: 'open' },
        })
      ).status,
    ).toBe(200);
    expect(
      await write('PATCH', '/entity/order/1', {
        notes: 'x',
        $where: { cost: { $gt: 1 } },
      }),
    ).toEqual({
      status: 403,
      body: {
        code: 'FORBIDDEN_FIELDS',
        message:
          "API key policy 'writer' does not allow $where on these fields of 'order', which it cannot read: 'cost'",
        fields: ['cost'],
      },
    });
  });

  it('checks an upsert against both lists, and needs $entityId since the URL chooses the ID', async () => {
    expect(
      (await write('PUT', '/entity/order/1', { notes: 'x' })).body.fields,
    ).toEqual(['$entityId']);
    expect(
      (await write('PUT', '/entity/invoice/1', { notes: 'x' })).status,
    ).toBe(200);
    expect(
      (await write('PUT', '/entity/invoice/1', { total: 5 })).body,
    ).toEqual({
      code: 'FORBIDDEN_FIELDS',
      message:
        "API key policy 'writer' does not allow update on these fields of 'invoice': 'total'",
      fields: ['total'],
    });
  });

  it('checks adjusted fields against the update list', async () => {
    expect(
      (
        await write('POST', '/entity/order/1/adjust', {
          quantity: 1,
          $condition: 'inStock',
        })
      ).status,
    ).toBe(200);
    expect(
      (await write('POST', '/entity/order/1/adjust', { total: 5 })).body.fields,
    ).toEqual(['total']);
  });

  it('checks mutualData against the direction create and update lists', async () => {
    expect(
      (await write('POST', '/mutual/learner/1/course/9', { role: 'student' }))
        .status,
    ).toBe(200);
    expect(
      await write('POST', '/mutual/learner/1/course/9', {
        role: 'student',
        appliedAt: 'now',
      }),
    ).toEqual({
      status: 403,
      body: {
        code: 'FORBIDDEN_FIELDS',
        message:
          "API key policy 'writer' does not allow create on these mutualData fields of learner→course: 'appliedAt'",
        fields: ['appliedAt'],
      },
    });
    expect(
      (await write('PATCH', '/mutual/learner/1/course/9', { role: 'auditor' }))
        .status,
    ).toBe(200);
  });

  it('checks the same fields in transaction operations, with the operation index', async () => {
    const run = (operations: unknown[]) =>
      write('POST', '/transaction', { operations });

    expect(
      (
        await run([
          {
            operation: 'createEntity',
            entityType: 'order',
            payload: { customerId: 'c' },
          },
          {
            operation: 'updateEntity',
            entityType: 'order',
            entityId: '1',
            payload: { status: 'paid' },
          },
          {
            operation: 'adjustEntity',
            entityType: 'order',
            entityId: '1',
            adjustments: { quantity: 1 },
          },
          {
            operation: 'updateMutual',
            byEntityType: 'learner',
            byEntityId: '1',
            entityType: 'course',
            entityId: '9',
            payload: { role: 'auditor' },
          },
        ])
      ).status,
    ).toBe(200);

    const denied = async (operation: unknown) => (await run([operation])).body;
    expect(
      await denied({
        operation: 'createEntity',
        entityType: 'order',
        entityId: 'x',
        payload: {},
      }),
    ).toMatchObject({
      code: 'FORBIDDEN_FIELDS',
      fields: ['$entityId'],
      operationIndex: 0,
    });
    expect(
      await denied({
        operation: 'updateEntity',
        entityType: 'order',
        entityId: '1',
        payload: { total: 1 },
      }),
    ).toMatchObject({ fields: ['total'] });
    expect(
      await denied({
        operation: 'adjustEntity',
        entityType: 'order',
        entityId: '1',
        adjustments: { total: 1 },
      }),
    ).toMatchObject({ fields: ['total'] });
    expect(
      await denied({
        operation: 'createMutual',
        byEntityType: 'learner',
        byEntityId: '1',
        entityType: 'course',
        entityId: '9',
        payload: { appliedAt: 'now' },
      }),
    ).toMatchObject({ fields: ['appliedAt'] });
  });
});
