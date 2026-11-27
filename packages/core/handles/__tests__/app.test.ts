import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DependencyContainer } from '../../services/DependencyContainer';
import { createCoreApp } from '../app';

const KEY = 'full-key';

const container = () =>
  new DependencyContainer({
    // biome-ignore lint/suspicious/noExplicitAny: no entity configs are needed for these routes
    EntityConfig: {} as any,
    AllowedEntityTypes: [],
    EmailAuthEnabledEntities: [],
  });

const customRoutes = new Hono()
  .get('/boom', () => {
    throw new Error('boom');
  })
  .get('/teapot', () => {
    throw new HTTPException(418, { message: 'short and stout' });
  });

const get = (app: Hono, path: string, key: string | null = KEY) =>
  app.request(path, { headers: key ? { 'x-api-key': key } : {} });

describe('createCoreApp', () => {
  const previousKeys = process.env.API_KEYS;
  beforeEach(() => {
    process.env.API_KEYS = JSON.stringify([KEY]);
  });
  afterEach(() => {
    process.env.API_KEYS = previousKeys;
    vi.restoreAllMocks();
  });

  it('answers an unknown path with a 404 and a code', async () => {
    const app = createCoreApp(container());

    for (const path of [
      '/core/nonexistent',
      '/core/ws/ticket',
      '/core/app/anything',
    ]) {
      const res = await get(app, path);
      expect(res.status, path).toBe(404);
      expect(await res.json()).toEqual({
        code: 'NOT_FOUND',
        message: `No route for GET ${path}`,
      });
    }
  });

  it('answers an unknown path with a 404 when the app has custom routes', async () => {
    const res = await get(
      createCoreApp(container(), { routes: customRoutes }),
      '/core/app/anything',
    );

    expect(res.status).toBe(404);
  });

  it('checks the API key before saying a path is unknown', async () => {
    const res = await get(
      createCoreApp(container()),
      '/core/nonexistent',
      null,
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      code: 'UNAUTHORIZED',
      message: 'Missing or unknown API key',
    });
  });

  it('answers an unhandled error with a 500 carrying an ID it logs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await get(
      createCoreApp(container(), { routes: customRoutes }),
      '/core/app/boom',
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({
      code: 'INTERNAL_SERVER_EXCEPTION',
      id: expect.any(String),
    });
    expect(warn).toHaveBeenCalledWith(
      '[MONORISE_DEBUG] INTERNAL_SERVER_EXCEPTION:',
      expect.objectContaining({
        errorId: body.id,
        errorMessage: 'boom',
        path: '/core/app/boom',
      }),
    );
  });

  it("keeps the response of Hono's own errors", async () => {
    const res = await get(
      createCoreApp(container(), { routes: customRoutes }),
      '/core/app/teapot',
    );

    expect(res.status).toBe(418);
    expect(await res.text()).toBe('short and stout');
  });
});
