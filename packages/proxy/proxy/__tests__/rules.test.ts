import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  EntityOperation,
  ProxyOperation,
  RelationshipOperation,
  RouteOperation,
} from '../operations';
import {
  type ProxyRule,
  type ProxyRules,
  type RouteRules,
  allow,
  checkOperations,
  deny,
  findRule,
} from '../rules';

const entity = (
  action: EntityOperation['action'],
  entityType = 'order',
  extra: Partial<EntityOperation> = {},
): EntityOperation => ({ kind: 'entity', action, entityType, ...extra });

const relationship = (
  action: RelationshipOperation['action'],
  byEntityType = 'learner',
  entityType = 'course',
): RelationshipOperation => ({
  kind: 'relationship',
  action,
  byEntityType,
  byEntityId: 'l1',
  entityType,
});

const route = (method: string, path: string): RouteOperation => ({
  kind: 'route',
  method,
  path,
});

// Named rules, so a test can tell which one findRule picked.
const named = (name: string): ProxyRule => {
  const rule: ProxyRule = () => true;
  Object.defineProperty(rule, 'name', { value: name });
  return rule;
};
const picked = (
  rules: ProxyRules | undefined,
  operation: ProxyOperation,
  routes?: RouteRules,
) =>
  findRule(rules as ProxyRules<never>, routes as RouteRules<never>, operation)
    ?.rule.name;

describe('findRule: entity operations', () => {
  it('prefers the action, then the entity fallback, then the table fallback', () => {
    const rules = {
      '*': { get: named('table-get') },
      order: { update: named('order-update'), '*': named('order-any') },
      invoice: { update: named('invoice-update') },
    };

    expect(picked(rules, entity('update'))).toBe('order-update');
    expect(picked(rules, entity('delete'))).toBe('order-any');
    expect(picked(rules, entity('get', 'invoice'))).toBe('table-get');
    expect(picked(rules, entity('delete', 'invoice'))).toBeUndefined();
  });

  it('uses a single rule on an entity for every action', () => {
    expect(picked({ order: named('order') }, entity('delete'))).toBe('order');
  });

  it('uses a single rule at the table level for everything', () => {
    const rules = { '*': named('everything') };

    expect(picked(rules, entity('delete', 'anything'))).toBe('everything');
    expect(picked(rules, relationship('create'))).toBe('everything');
    expect(picked(undefined, entity('get'), {})).toBeUndefined();
  });

  it('finds nothing for an empty table, so the operation is refused', () => {
    expect(picked({}, entity('get'))).toBeUndefined();
  });

  it('ignores entity types named like Object.prototype members', () => {
    expect(
      picked({ order: allow }, entity('get', 'constructor')),
    ).toBeUndefined();
  });
});

describe('findRule: relationship operations', () => {
  it('prefers the action, then the target fallback, then the relationships fallback, then the table', () => {
    const rules = {
      '*': { read: named('table-read') },
      learner: {
        mutuals: {
          course: { create: named('course-create'), '*': named('course-any') },
          '*': { delete: named('mutuals-delete') },
        },
      },
    };

    expect(picked(rules, relationship('create'))).toBe('course-create');
    expect(picked(rules, relationship('update'))).toBe('course-any');
    expect(picked(rules, relationship('delete', 'learner', 'cohort'))).toBe(
      'mutuals-delete',
    );
    expect(picked(rules, relationship('read', 'learner', 'cohort'))).toBe(
      'table-read',
    );
    expect(
      picked(rules, relationship('update', 'learner', 'cohort')),
    ).toBeUndefined();
  });

  it('uses a single rule on a target for every action on it', () => {
    const rules = { learner: { mutuals: { course: named('course') } } };

    expect(picked(rules, relationship('delete'))).toBe('course');
  });

  it("covers an entity's relationships with a single rule on the entity", () => {
    expect(picked({ learner: named('learner') }, relationship('read'))).toBe(
      'learner',
    );
  });

  it("does not apply an entity's own '*' to its relationships", () => {
    const rules = { learner: { '*': named('learner-any') } };

    expect(picked(rules, relationship('read'))).toBeUndefined();
  });
});

describe('findRule: custom routes', () => {
  const routes = {
    'POST /app/invite-casting': named('exact'),
    'PATCH /app/activity/:id/reschedule': named('param'),
    'GET /app/reports/*': named('rest'),
    '*': named('any-route'),
  };

  it('prefers an exact route, then patterns, then the routes fallback', () => {
    expect(picked({}, route('POST', '/app/invite-casting'), routes)).toBe(
      'exact',
    );
    expect(
      picked({}, route('PATCH', '/app/activity/a1/reschedule'), routes),
    ).toBe('param');
    expect(picked({}, route('GET', '/app/reports/sales/2026'), routes)).toBe(
      'rest',
    );
    expect(picked({}, route('GET', '/app/reports'), routes)).toBe('rest');
    expect(picked({}, route('DELETE', '/app/other'), routes)).toBe('any-route');
  });

  it('picks the most specific pattern, whatever order they are declared in', () => {
    const broadFirst = {
      'GET /app/*': named('broad'),
      'GET /app/:section/:id': named('two-params'),
      'GET /app/admin/*': named('admin-rest'),
      'GET /app/admin/:id': named('admin'),
    };

    expect(picked({}, route('GET', '/app/admin/1'), broadFirst)).toBe('admin');
    expect(picked({}, route('GET', '/app/admin/1/logs'), broadFirst)).toBe(
      'admin-rest',
    );
    expect(picked({}, route('GET', '/app/users/5'), broadFirst)).toBe(
      'two-params',
    );
    expect(picked({}, route('GET', '/app/users/5/x'), broadFirst)).toBe(
      'broad',
    );
  });

  it('passes the captured params to the rule', () => {
    const found = findRule(
      {},
      routes as RouteRules<never>,
      route('PATCH', '/app/activity/a1/reschedule'),
    );

    expect(found?.operation).toEqual({
      kind: 'route',
      method: 'PATCH',
      path: '/app/activity/a1/reschedule',
      params: { id: 'a1' },
    });
  });

  it('matches the method exactly, and falls back to a single table rule but not to rules per action', () => {
    expect(
      picked({}, route('GET', '/app/invite-casting'), {
        'POST /app/invite-casting': allow,
      }),
    ).toBeUndefined();
    expect(picked({ '*': named('everything') }, route('GET', '/app/x'))).toBe(
      'everything',
    );
    expect(
      picked({ '*': { get: allow } }, route('GET', '/app/x')),
    ).toBeUndefined();
  });
});

describe('checkOperations', () => {
  afterEach(() => vi.restoreAllMocks());

  const context = {
    session: { userId: 'u1' },
    request: new Request('http://proxy/api/core/entity/order'),
    core: { get: vi.fn(), fetch: vi.fn() },
  };
  const check = (
    operations: ProxyOperation[],
    rules: ProxyRules<{ userId: string }>,
    logMissingRules = false,
  ) => checkOperations({ operations, rules, context, logMissingRules });
  const body = async (response: Response | undefined) => ({
    status: response?.status,
    body: await response?.json(),
  });

  it('lets every operation through when every rule returns true', async () => {
    expect(
      await check([entity('get'), entity('list')], { order: allow }),
    ).toBeUndefined();
  });

  it('refuses an operation with no rule, naming it', async () => {
    expect(await body(await check([entity('delete')], {}))).toEqual({
      status: 403,
      body: {
        code: 'FORBIDDEN',
        message: "No proxy rule for delete on 'order'",
      },
    });
  });

  it('refuses when a rule returns false', async () => {
    expect(
      await body(
        await check([relationship('create')], {
          learner: { mutuals: { course: deny } },
        }),
      ),
    ).toEqual({
      status: 403,
      body: {
        code: 'FORBIDDEN',
        message: 'Proxy rule refused create on learner→course',
      },
    });
  });

  it('only forwards on true, so a rule that forgets to return refuses', async () => {
    const forgetful = (() => undefined) as unknown as ProxyRule;

    expect((await check([entity('get')], { order: forgetful }))?.status).toBe(
      403,
    );
  });

  it('sends a Response a rule returns as is', async () => {
    const teapot = new Response('no', { status: 418 });

    expect(await check([entity('get')], { order: () => teapot })).toBe(teapot);
  });

  it('gives each rule the operation and the context, awaiting async rules', async () => {
    const rule = vi.fn(
      async (operation: ProxyOperation, { session }) =>
        operation.kind === 'entity' &&
        operation.entityId === (session as { userId: string })?.userId,
    );

    expect(
      await check([entity('get', 'user', { entityId: 'u1' })], {
        user: { get: rule },
      }),
    ).toBeUndefined();
    expect(rule).toHaveBeenCalledWith(
      entity('get', 'user', { entityId: 'u1' }),
      context,
    );
    expect(
      (
        await check([entity('get', 'user', { entityId: 'u2' })], {
          user: { get: rule },
        })
      )?.status,
    ).toBe(403);
  });

  it('stops at the first refusal and reports its transaction index', async () => {
    const later = vi.fn(() => true);
    const response = await check(
      [
        entity('update', 'order', { operationIndex: 0 }),
        entity('delete', 'order', { operationIndex: 1 }),
        entity('get', 'invoice', { operationIndex: 2 }),
      ],
      { order: { update: allow }, invoice: later },
    );

    expect(await body(response)).toEqual({
      status: 403,
      body: {
        code: 'FORBIDDEN',
        message: "No proxy rule for delete on 'order'",
        operationIndex: 1,
      },
    });
    expect(later).not.toHaveBeenCalled();
  });

  it('logs the rule to add when asked to', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await check([relationship('delete')], {}, true);

    expect(warn).toHaveBeenCalledWith(
      "[monorise/proxy] No rule for delete on learner→course. Add one: rules: { 'learner': { mutuals: { 'course': { delete: (operation, { session }) => … } } } }",
    );
  });
});
