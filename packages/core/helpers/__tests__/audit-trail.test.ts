import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createApiKeyAuth,
  fingerprintApiKey,
  parseApiKeys,
} from '../../middlewares/api-key-auth';
import { publishEvent } from '../event';
import { currentApiKey, runWithApiKey } from '../request-context';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: vi.fn(() => ({ send })),
  PutEventsCommand: vi.fn((input) => ({ input })),
}));

const sentDetail = () =>
  JSON.parse(send.mock.calls.at(-1)?.[0].input.Entries[0].Detail);

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

describe('request API key context', () => {
  const app = new Hono();
  app.use(
    createApiKeyAuth(
      parseApiKeys('{"full": ["admin"], "client": ["app"]}', [
        'full',
        'client',
      ]),
      { client: 'read' },
    ),
  );
  app.get('/', async (c) => {
    // Read after awaits, as a service publishing an event would.
    await tick();
    await tick();
    return c.json(currentApiKey() ?? null);
  });
  const request = (key: string) =>
    app.request('/', { headers: { 'x-api-key': key } });

  it('is the resolved key for everything the request runs', async () => {
    const res = await request('app');

    expect(await res.json()).toEqual({
      policy: 'client',
      fingerprint: fingerprintApiKey('app'),
    });
  });

  it('keeps concurrent requests apart', async () => {
    const [admin, client] = await Promise.all([
      request('admin'),
      request('app'),
    ]);

    expect((await admin.json()).policy).toBe('full');
    expect((await client.json()).policy).toBe('client');
  });

  it('is undefined outside a request, as in a processor', async () => {
    await request('app');

    expect(currentApiKey()).toBeUndefined();
  });
});

describe('publishEvent', () => {
  beforeEach(() => send.mockReset().mockResolvedValue({}));

  const event = { Source: 'core', DetailType: 'entity.updated' };
  const apiKey = { policy: 'client', fingerprint: 'abc' };

  it('records the API key of the request that published it', async () => {
    await runWithApiKey(apiKey, () =>
      publishEvent({
        event,
        payload: { entityId: '1', updatedByAccountId: 'u' },
      }),
    );

    expect(sentDetail()).toEqual({
      entityId: '1',
      updatedByAccountId: 'u',
      apiKey,
    });
  });

  it('records no key for an event published outside a request', async () => {
    await publishEvent({ event, payload: { entityId: '1' } });

    expect(sentDetail()).toEqual({ entityId: '1' });
  });
});
