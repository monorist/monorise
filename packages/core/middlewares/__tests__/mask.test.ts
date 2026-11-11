import type { ApiKeyPolicies } from '@monorise/base';
import { type Context, Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { compileApiKeyPolicy } from '../../../base';
import { setupCommonRoutes } from '../../controllers/setupRoutes';
import { DependencyContainer } from '../../services/DependencyContainer';
import { createApiKeyAuth, parseApiKeys } from '../api-key-auth';
import { maskFields, maskResponseBody, maskResponses } from '../mask';

const policies: ApiKeyPolicies = {
  client: {
    entities: {
      order: { read: ['total', 'status'] },
      learner: {
        read: ['name'],
        mutuals: { course: { read: ['role'] } },
      },
      course: { read: ['title'] },
      product: 'read',
    },
  },
};
const access = compileApiKeyPolicy('client', policies.client);

const order = {
  entityType: 'order',
  entityId: '1',
  data: { total: 10, status: 'paid', cost: 4, notes: 'internal' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const maskedOrder = { ...order, data: { total: 10, status: 'paid' } };

describe('maskFields', () => {
  it('keeps everything for *, the allowlist for a set, and nothing for null', () => {
    const data = { a: 1, b: 2 };

    expect(maskFields(data, '*')).toBe(data);
    expect(maskFields(data, new Set(['a']))).toEqual({ a: 1 });
    expect(maskFields(data, null)).toEqual({});
  });
});

describe('maskResponseBody', () => {
  it('masks a single entity', () => {
    expect(maskResponseBody(order, access)).toEqual(maskedOrder);
  });

  it("masks every entity in a list's data", () => {
    expect(
      maskResponseBody(
        { data: [order, order], totalCount: 2, lastKey: 'k' },
        access,
      ),
    ).toEqual({
      data: [maskedOrder, maskedOrder],
      totalCount: 2,
      lastKey: 'k',
    });
  });

  it('masks tags by their entity type', () => {
    const tag = { tagName: 'region', group: 'eu', ...order };

    expect(maskResponseBody({ entities: [tag] }, access)).toEqual({
      entities: [{ ...tag, data: { total: 10, status: 'paid' } }],
    });
  });

  it("masks a relationship's target data and its mutualData by direction", () => {
    const mutual = {
      byEntityType: 'learner',
      byEntityId: '1',
      entityType: 'course',
      entityId: '9',
      mutualId: 'm',
      data: { title: 'Maths', price: 100 },
      mutualData: { role: 'student', appliedAt: 'now' },
    };

    expect(
      maskResponseBody({ entities: [mutual], lastKey: undefined }, access),
    ).toEqual({
      entities: [
        {
          ...mutual,
          data: { title: 'Maths' },
          mutualData: { role: 'student' },
        },
      ],
    });
  });

  it('masks entity and relationship entries in transaction results', () => {
    const results = [
      { operation: 'createEntity', ...order },
      {
        operation: 'createMutual',
        byEntityType: 'course',
        byEntityId: '9',
        entityType: 'learner',
        entityId: '1',
        data: { name: 'Ann', email: 'a@b.co' },
        mutualData: { role: 'student' },
      },
    ];

    expect(maskResponseBody({ results }, access)).toEqual({
      results: [
        { operation: 'createEntity', ...maskedOrder },
        // course→learner has no entry, so none of its mutualData is readable.
        { ...results[1], data: { name: 'Ann' }, mutualData: {} },
      ],
    });
  });

  it('removes all data of a type the policy does not let it read', () => {
    expect(
      maskResponseBody({ ...order, entityType: 'payment' }, access),
    ).toEqual({
      ...order,
      entityType: 'payment',
      data: {},
    });
  });

  it('leaves full-read types, and bodies without records, untouched', () => {
    const product = { entityType: 'product', entityId: '1', data: { a: 1 } };

    expect(maskResponseBody(product, access)).toEqual(product);
    expect(maskResponseBody({ message: 'entity deleted' }, access)).toEqual({
      message: 'entity deleted',
    });
  });

  it('does not look inside data for nested records', () => {
    const nested = {
      entityType: 'product',
      entityId: '1',
      data: { related: { entityType: 'order', data: { cost: 4 } } },
    };

    expect(maskResponseBody(nested, access)).toEqual(nested);
  });
});

describe('maskResponses', () => {
  const app = new Hono();
  app.use(
    createApiKeyAuth(
      parseApiKeys('{"full": ["full-key"], "client": ["client-key"]}', [
        'full',
        'client',
      ]),
      policies,
    ),
  );
  app.use('*', maskResponses());
  app.get('/order', (c) => {
    c.header('x-request-id', 'r1');
    c.status(201);
    return c.json(order);
  });
  app.get('/missing', (c) => {
    c.status(404);
    return c.json({
      code: 'ENTITY_NOT_FOUND',
      data: { cost: 4 },
      entityType: 'order',
    });
  });
  app.get('/text', (c) => c.text('plain'));

  const get = (path: string, key: string) =>
    app.request(path, { headers: { 'x-api-key': key } });

  it("masks a restricted key's JSON response, keeping status and headers", async () => {
    const res = await get('/order', 'client-key');

    expect(res.status).toBe(201);
    expect(res.headers.get('x-request-id')).toBe('r1');
    expect(await res.json()).toEqual(maskedOrder);
  });

  it('leaves full keys, error responses and non-JSON untouched', async () => {
    expect(await (await get('/order', 'full-key')).json()).toEqual(order);
    expect((await (await get('/missing', 'client-key')).json()).data).toEqual({
      cost: 4,
    });
    expect(await (await get('/text', 'client-key')).text()).toBe('plain');
  });

  it('exposes the same masking on the key, for custom routes', async () => {
    const inspect = new Hono();
    inspect.use(
      createApiKeyAuth(
        parseApiKeys('{"client": ["client-key"]}', ['client']),
        policies,
      ),
    );
    inspect.get('/', (c) =>
      c.json(
        c.get('apiKey').mask('order', {
          // An Entity instance: mask() reads it through toJSON().
          toJSON: () => order,
        }),
      ),
    );

    const res = await inspect.request('/', {
      headers: { 'x-api-key': 'client-key' },
    });

    expect(await res.json()).toEqual(maskedOrder);
  });
});

describe('setupCommonRoutes masking', () => {
  it('masks what a built-in route responds with', async () => {
    // The real routes and guards, with only the controller stubbed.
    class StubContainer extends DependencyContainer {
      get getEntityController() {
        return { controller: (c: Context) => c.json(order) } as never;
      }
    }
    const container = new StubContainer({
      EntityConfig: {} as never,
      AllowedEntityTypes: [],
      EmailAuthEnabledEntities: [],
    });
    const app = new Hono();
    app.use(
      createApiKeyAuth(
        parseApiKeys('{"client": ["client-key"]}', ['client']),
        policies,
      ),
    );
    app.route('/', setupCommonRoutes(container));

    const res = await app.request('/entity/order/1', {
      headers: { 'x-api-key': 'client-key' },
    });

    expect(await res.json()).toEqual(maskedOrder);
  });
});
