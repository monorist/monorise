import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProxyHandler } from '../handler';
import type { ProxyOperation } from '../operations';
import { type ProxyRule, allow, deny } from '../rules';

type Session = { type: 'hirer' | 'talent'; hirerId?: string; userId: string };

const config = {
  EntityConfig: {
    learner: {
      mutual: { mutualFields: { courseIds: { entityType: 'course' } } },
    },
  },
};

const sessions: Record<string, Session> = {
  'hirer-cookie': { type: 'hirer', hirerId: 'h1', userId: 'u1' },
  'talent-cookie': { type: 'talent', userId: 'u2' },
};
const readSession = (request: Request) =>
  sessions[request.headers.get('cookie') ?? ''];

const isMyOrganization: ProxyRule<Session> = (operation, { session }) =>
  operation.kind === 'entity' && operation.entityId === session?.hirerId;

const proxy = createProxyHandler<Session>({
  config,
  apiBaseUrl: 'https://core.example.com/',
  authenticate: readSession,
  caller: ({ session }) => session?.type ?? 'public',
  callers: {
    hirer: {
      apiKey: 'hirer-key',
      rules: {
        order: allow,
        'hirer-organization': { get: isMyOrganization },
        learner: {
          create: allow,
          update: allow,
          mutuals: { course: { create: allow } },
        },
      },
      routes: {
        'POST /app/invite-casting': (operation, { session }) =>
          (operation.body as { hirerId?: string })?.hirerId ===
          session?.hirerId,
      },
    },
    talent: { apiKey: 'talent-key', rules: { order: { get: allow } } },
    public: { apiKey: 'public-key', rules: { project: { list: allow } } },
  },
});

const coreFetch = vi.fn<typeof fetch>();
beforeEach(() => {
  coreFetch.mockReset();
  coreFetch.mockResolvedValue(
    Response.json({ ok: true }, { headers: { 'x-core': 'yes' } }),
  );
  vi.stubGlobal('fetch', coreFetch);
});
afterEach(() => vi.unstubAllGlobals());

const request = (
  method: string,
  path: string,
  {
    cookie,
    body,
    headers = {},
  }: { cookie?: string; body?: unknown; headers?: Record<string, string> } = {},
) =>
  new Request(`http://app.example.com${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body:
      body === undefined
        ? undefined
        : typeof body === 'string'
          ? body
          : JSON.stringify(body),
  });

const forwarded = () => {
  expect(coreFetch).toHaveBeenCalledTimes(1);
  const [url, init] = coreFetch.mock.calls[0];
  return {
    url,
    method: init?.method,
    headers: Object.fromEntries(new Headers(init?.headers).entries()),
    body:
      init?.body instanceof ArrayBuffer
        ? new TextDecoder().decode(init.body)
        : init?.body,
  };
};

const read = async (response: Response) => ({
  status: response.status,
  body: await response.json(),
});

describe('createProxyHandler: forwarding', () => {
  it("forwards to Core under /core with the caller's key and the query string", async () => {
    await proxy.handle(
      request('GET', '/api/core/entity/order/o1?fields=a', {
        cookie: 'hirer-cookie',
      }),
    );

    expect(forwarded()).toMatchObject({
      url: 'https://core.example.com/core/entity/order/o1?fields=a',
      method: 'GET',
      headers: { 'x-api-key': 'hirer-key' },
      body: undefined,
    });
  });

  it('never forwards cookies, authorization, or a key the client sends', async () => {
    await proxy.handle(
      request('PATCH', '/api/core/entity/order/o1', {
        cookie: 'hirer-cookie',
        body: { status: 'paid' },
        headers: {
          authorization: 'Bearer abc',
          'x-api-key': 'stolen-admin-key',
          accept: 'application/json',
          'accept-language': 'ms',
          'x-request-id': 'r1',
          'x-forwarded-for': '1.2.3.4',
        },
      }),
    );

    expect(forwarded().headers).toEqual({
      'content-type': 'application/json',
      accept: 'application/json',
      'accept-language': 'ms',
      'x-request-id': 'r1',
      'x-api-key': 'hirer-key',
    });
  });

  it('forwards exactly the body it checked', async () => {
    const body = '{"status":"paid","status":"void"}';

    await proxy.handle(
      request('PATCH', '/api/core/entity/order/o1', {
        cookie: 'hirer-cookie',
        body,
      }),
    );

    expect(forwarded().body).toBe(body);
  });

  it("passes Core's status, body and headers through", async () => {
    coreFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ code: 'FORBIDDEN_FIELDS', fields: ['x'] }),
        {
          status: 403,
          statusText: 'Forbidden',
          headers: {
            'content-type': 'application/json',
            'x-core': 'yes',
            'content-encoding': 'gzip',
          },
        },
      ),
    );

    const response = await proxy.handle(
      request('GET', '/api/core/entity/order/o1', { cookie: 'hirer-cookie' }),
    );

    expect(response.status).toBe(403);
    expect(response.statusText).toBe('Forbidden');
    expect(response.headers.get('x-core')).toBe('yes');
    // fetch has already decoded the body.
    expect(response.headers.get('content-encoding')).toBeNull();
    expect(await response.json()).toEqual({
      code: 'FORBIDDEN_FIELDS',
      fields: ['x'],
    });
  });

  it('answers 502 when Core is unreachable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    coreFetch.mockRejectedValue(new TypeError('fetch failed'));

    expect(
      (
        await proxy.handle(
          request('GET', '/api/core/entity/order/o1', {
            cookie: 'hirer-cookie',
          }),
        )
      ).status,
    ).toBe(502);
  });
});

describe('createProxyHandler: callers', () => {
  it('uses each caller’s own key and rules', async () => {
    const asTalent = await proxy.handle(
      request('DELETE', '/api/core/entity/order/o1', {
        cookie: 'talent-cookie',
      }),
    );

    expect(await read(asTalent)).toEqual({
      status: 403,
      body: {
        code: 'FORBIDDEN',
        message: "No proxy rule for delete on 'order'",
      },
    });
    expect(coreFetch).not.toHaveBeenCalled();

    await proxy.handle(
      request('DELETE', '/api/core/entity/order/o1', {
        cookie: 'hirer-cookie',
      }),
    );
    expect(forwarded().headers['x-api-key']).toBe('hirer-key');
  });

  it('uses the public caller for an anonymous visitor', async () => {
    await proxy.handle(request('GET', '/api/core/entity/project'));

    expect(forwarded().headers['x-api-key']).toBe('public-key');
  });

  it('answers 401 to a caller with no entry', async () => {
    const noPublic = createProxyHandler<Session>({
      config,
      apiBaseUrl: 'https://core.example.com',
      authenticate: readSession,
      caller: ({ session }) => session?.type,
      callers: { hirer: { apiKey: 'hirer-key', rules: { '*': allow } } },
    });

    for (const cookie of [undefined, 'talent-cookie']) {
      expect(
        await read(
          await noPublic.handle(
            request('GET', '/api/core/entity/order', { cookie }),
          ),
        ),
      ).toEqual({
        status: 401,
        body: { code: 'UNAUTHORIZED', message: 'Unauthorized' },
      });
    }
    expect(coreFetch).not.toHaveBeenCalled();
  });

  it('never matches a caller named like an Object.prototype member', async () => {
    const handler = createProxyHandler({
      config,
      apiBaseUrl: 'https://core.example.com',
      caller: () => 'constructor',
      callers: {},
    });

    expect(
      (await handler.handle(request('GET', '/api/core/entity/order'))).status,
    ).toBe(401);
  });

  it('sends a Response from authenticate back as is', async () => {
    const expired = new Response(null, {
      status: 401,
      headers: { 'set-cookie': 'session=; Max-Age=0' },
    });
    const handler = createProxyHandler({
      config,
      apiBaseUrl: 'https://core.example.com',
      authenticate: () => expired,
      apiKey: 'admin-key',
      rules: { '*': allow },
    });

    expect(await handler.handle(request('GET', '/api/core/entity/order'))).toBe(
      expired,
    );
  });

  it('answers 401 to an anonymous visitor when one kind of caller authenticates', async () => {
    const admin = createProxyHandler({
      config,
      apiBaseUrl: 'https://core.example.com',
      authenticate: (req) =>
        req.headers.get('cookie') === 'admin' ? { admin: true } : null,
      apiKey: 'admin-key',
      rules: { '*': allow },
    });

    expect(
      (await admin.handle(request('GET', '/api/core/entity/order'))).status,
    ).toBe(401);
    await admin.handle(
      request('DELETE', '/api/core/entity/order/o1', { cookie: 'admin' }),
    );
    expect(forwarded().headers['x-api-key']).toBe('admin-key');
  });

  it('forwards every request when one kind of caller has no authenticate', async () => {
    const server = createProxyHandler({
      config,
      apiBaseUrl: 'https://core.example.com',
      apiKey: 'server-key',
      rules: { '*': allow },
    });

    await server.handle(request('GET', '/api/core/entity/order'));

    expect(forwarded().headers['x-api-key']).toBe('server-key');
  });

  it('rejects options that mix both forms', () => {
    expect(() =>
      createProxyHandler({
        config,
        caller: () => 'a',
        callers: {},
        apiKey: 'k',
      } as never),
    ).toThrow('either caller and callers, or apiKey and rules');
  });
});

describe('createProxyHandler: refusals', () => {
  it('runs rules with the session, and refuses without forwarding', async () => {
    expect(
      (
        await proxy.handle(
          request('GET', '/api/core/entity/hirer-organization/h2', {
            cookie: 'hirer-cookie',
          }),
        )
      ).status,
    ).toBe(403);
    expect(coreFetch).not.toHaveBeenCalled();

    await proxy.handle(
      request('GET', '/api/core/entity/hirer-organization/h1', {
        cookie: 'hirer-cookie',
      }),
    );
    expect(forwarded().url).toBe(
      'https://core.example.com/core/entity/hirer-organization/h1',
    );
  });

  it('refuses a relationship field the rules do not allow', async () => {
    expect(
      await read(
        await proxy.handle(
          request('PATCH', '/api/core/entity/learner/l1', {
            cookie: 'hirer-cookie',
            body: { courseIds: ['c1'] },
          }),
        ),
      ),
    ).toEqual({
      status: 403,
      body: {
        code: 'FORBIDDEN',
        message: 'No proxy rule for delete on learner→course',
      },
    });
  });

  it('refuses a whole transaction for one refused operation, naming its index', async () => {
    expect(
      await read(
        await proxy.handle(
          request('POST', '/api/core/transaction', {
            cookie: 'hirer-cookie',
            body: {
              operations: [
                {
                  operation: 'updateEntity',
                  entityType: 'order',
                  entityId: 'o1',
                },
                {
                  operation: 'deleteEntity',
                  entityType: 'project',
                  entityId: 'p1',
                },
              ],
            },
          }),
        ),
      ),
    ).toEqual({
      status: 403,
      body: {
        code: 'FORBIDDEN',
        message: "No proxy rule for delete on 'project'",
        operationIndex: 1,
      },
    });
    expect(coreFetch).not.toHaveBeenCalled();
  });

  it('checks custom routes against their body', async () => {
    const invite = (hirerId: string) =>
      proxy.handle(
        request('POST', '/api/core/app/invite-casting', {
          cookie: 'hirer-cookie',
          body: { hirerId },
        }),
      );

    expect((await invite('h2')).status).toBe(403);
    await invite('h1');
    expect(forwarded().url).toBe(
      'https://core.example.com/core/app/invite-casting',
    );
  });

  it.each<[string, string, string | undefined, number, string]>([
    [
      'a path outside basePath',
      '/api/other/entity/order',
      undefined,
      404,
      'NOT_FOUND',
    ],
    [
      'a path Core does not serve',
      '/api/core/nope',
      undefined,
      404,
      'NOT_FOUND',
    ],
    [
      'the WebSocket ticket route',
      '/api/core/ws/ticket/user/u1',
      '{}',
      404,
      'NOT_FOUND',
    ],
    [
      'a body that is not JSON',
      '/api/core/entity/order',
      'not json',
      400,
      'BAD_REQUEST',
    ],
  ])('answers %s with %i', async (_, path, body, status, code) => {
    const response = await proxy.handle(
      request(body === undefined ? 'GET' : 'POST', path, {
        cookie: 'hirer-cookie',
        body,
      }),
    );

    expect(await read(response)).toMatchObject({ status, body: { code } });
    expect(coreFetch).not.toHaveBeenCalled();
  });

  it('answers 500 when the chosen caller has no key, or Core has no URL', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const noKey = createProxyHandler({
      config,
      apiBaseUrl: 'https://core.example.com',
      caller: () => 'hirer',
      callers: { hirer: { apiKey: undefined, rules: { '*': allow } } },
    });
    vi.stubEnv('API_BASE_URL', '');
    const noUrl = createProxyHandler({
      config,
      apiKey: 'k',
      rules: { '*': allow },
    });

    expect(
      await read(await noKey.handle(request('GET', '/api/core/entity/order'))),
    ).toEqual({
      status: 500,
      body: {
        code: 'PROXY_MISCONFIGURED',
        message: "No apiKey is set for caller 'hirer'",
      },
    });
    expect(
      (await noUrl.handle(request('GET', '/api/core/entity/order'))).status,
    ).toBe(500);
    vi.unstubAllEnvs();
  });
});

describe('createProxyHandler: rule context', () => {
  it("gives rules a Core client with the caller's key", async () => {
    const inMyOrganization: ProxyRule<Session> = async (
      operation,
      { session, core },
    ) =>
      operation.kind === 'entity' &&
      (
        await core.get(
          `/mutual/hirer-organization/${session?.hirerId}/${operation.entityType}/${operation.entityId}`,
        )
      ).ok;
    const handler = createProxyHandler<Session>({
      config,
      apiBaseUrl: 'https://core.example.com',
      authenticate: readSession,
      caller: ({ session }) => session?.type,
      callers: {
        hirer: {
          apiKey: 'hirer-key',
          rules: { project: { get: inMyOrganization } },
        },
      },
    });

    await handler.handle(
      request('GET', '/api/core/entity/project/p1', {
        cookie: 'hirer-cookie',
      }),
    );

    expect(coreFetch).toHaveBeenCalledTimes(2);
    const [url, init] = coreFetch.mock.calls[0];
    expect(url).toBe(
      'https://core.example.com/core/mutual/hirer-organization/h1/project/p1',
    );
    expect(new Headers(init?.headers).get('x-api-key')).toBe('hirer-key');
  });

  it('leaves the request readable for authenticate and rules', async () => {
    const handler = createProxyHandler({
      config,
      apiBaseUrl: 'https://core.example.com',
      authenticate: async (req) => ({ body: await req.clone().json() }),
      apiKey: 'k',
      rules: {
        order: async (_, { request: original }) =>
          (await original.json()).total === 5,
      },
    });

    await handler.handle(
      request('POST', '/api/core/entity/order', { body: { total: 5 } }),
    );

    expect(forwarded().body).toBe('{"total":5}');
  });
});

describe('createProxyHandler: checkRequest', () => {
  it('runs every step but forwarding', async () => {
    expect(
      await proxy.checkRequest(
        request('GET', '/api/core/entity/order/o1', {
          cookie: 'talent-cookie',
        }),
      ),
    ).toEqual({
      allowed: true,
      caller: 'talent',
      session: sessions['talent-cookie'],
      operations: [
        { kind: 'entity', action: 'get', entityType: 'order', entityId: 'o1' },
      ],
    });

    const refused = await proxy.checkRequest(
      request('DELETE', '/api/core/entity/order/o1', {
        cookie: 'talent-cookie',
      }),
    );
    expect(refused.allowed).toBe(false);
    expect(!refused.allowed && refused.response.status).toBe(403);
    expect(coreFetch).not.toHaveBeenCalled();
  });
});

describe('createProxyHandler: frameworks', () => {
  const handler = createProxyHandler({
    config,
    apiBaseUrl: 'https://core.example.com',
    apiKey: 'k',
    rules: { order: { get: allow, create: allow }, '*': deny },
  });

  it('works as Next.js route exports, called with a second argument', async () => {
    const { GET, POST } = handler;
    const next = { params: Promise.resolve({ path: ['entity', 'order'] }) };

    await (GET as (r: Request, c: unknown) => Promise<Response>)(
      request('GET', '/api/core/entity/order/o1'),
      next,
    );
    await (POST as (r: Request, c: unknown) => Promise<Response>)(
      request('POST', '/api/core/entity/order', { body: { total: 1 } }),
      next,
    );

    expect(coreFetch.mock.calls.map(([url]) => url)).toEqual([
      'https://core.example.com/core/entity/order/o1',
      'https://core.example.com/core/entity/order',
    ]);
  });

  it('works as a React Router resource route', async () => {
    const loader = ({ request: req }: { request: Request }) =>
      handler.handle(req);
    const action = ({ request: req }: { request: Request }) =>
      handler.handle(req);

    await loader({ request: request('GET', '/api/core/entity/order/o1') });
    expect(
      (
        await action({
          request: request('DELETE', '/api/core/entity/order/o1'),
        })
      ).status,
    ).toBe(403);

    expect(coreFetch).toHaveBeenCalledTimes(1);
  });

  it('works behind a Hono route, with any basePath', async () => {
    const mounted = createProxyHandler({
      config,
      apiBaseUrl: 'https://core.example.com',
      basePath: '/monorise/',
      apiKey: 'k',
      rules: { order: { get: allow } },
    });
    const app = new Hono();
    app.all('/monorise/*', (c) => mounted.handle(c.req.raw));

    const response = await app.request('/monorise/entity/order/o1');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(forwarded().url).toBe(
      'https://core.example.com/core/entity/order/o1',
    );
  });
});
