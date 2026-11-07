import { Hono } from 'hono';
import httpStatus from 'http-status';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FULL_API_KEY_POLICY as FULL_POLICY } from '../../../base';
import {
  createApiKeyAuth,
  fingerprintApiKey,
  parseApiKeys,
} from '../api-key-auth';

// A real Hono app rather than a duck-typed context: the behaviour under test
// is the middleware's interplay with routing and c.set/c.get.
const appWith = (rawApiKeys: string | undefined, policies?: string[]) => {
  const app = new Hono().basePath('/core');
  app.use(createApiKeyAuth(parseApiKeys(rawApiKeys, policies)));
  app.all('*', (c) => c.json(c.get('apiKey')));
  return app;
};

const request = (app: Hono, key?: string, path = '/core/entity/user') =>
  app.request(path, { headers: key ? { 'x-api-key': key } : {} });

describe('parseApiKeys', () => {
  afterEach(() => vi.restoreAllMocks());

  it('maps every key in the legacy array form to the full policy', () => {
    const keys = parseApiKeys('["secret1", "secret2"]');

    expect(keys).toEqual(
      new Map([
        [fingerprintApiKey('secret1'), FULL_POLICY],
        [fingerprintApiKey('secret2'), FULL_POLICY],
      ]),
    );
  });

  it('maps keys in the object form to their policy', () => {
    const keys = parseApiKeys('{"full": ["a"], "reporting": ["b", "c"]}', [
      'full',
      'reporting',
    ]);

    expect(keys.get(fingerprintApiKey('a'))).toBe('full');
    expect(keys.get(fingerprintApiKey('b'))).toBe('reporting');
    expect(keys.get(fingerprintApiKey('c'))).toBe('reporting');
  });

  it('accepts pre-hashed sha256: entries, case-insensitively', () => {
    const hash = fingerprintApiKey('hashed-key');

    const keys = parseApiKeys(
      JSON.stringify({ full: [`sha256:${hash.toUpperCase()}`] }),
    );

    expect(keys.get(hash)).toBe(FULL_POLICY);
  });

  it('drops keys under a policy that is not defined, with an error log', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const keys = parseApiKeys('{"full": ["a"], "reporting": ["b"]}');

    expect(keys.get(fingerprintApiKey('a'))).toBe(FULL_POLICY);
    expect(keys.has(fingerprintApiKey('b'))).toBe(false);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("policy 'reporting' is not defined"),
    );
  });

  it('drops a key listed under more than one policy, with an error log', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const keys = parseApiKeys(
      '{"full": ["shared", "a"], "reporting": ["shared"]}',
      ['full', 'reporting'],
    );

    expect(keys.has(fingerprintApiKey('shared'))).toBe(false);
    expect(keys.get(fingerprintApiKey('a'))).toBe(FULL_POLICY);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('listed under more than one policy'),
    );
  });

  it('treats a key listed under both a defined and an undefined policy as a conflict', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const keys = parseApiKeys('{"full": ["shared"], "reporting": ["shared"]}');

    expect(keys.has(fingerprintApiKey('shared'))).toBe(false);
  });

  it('returns no keys when API_KEYS is unset or empty', () => {
    expect(parseApiKeys(undefined).size).toBe(0);
    expect(parseApiKeys('').size).toBe(0);
  });

  it.each([
    ['invalid JSON', 'not json'],
    ['a scalar', '42'],
    ['null', 'null'],
    ['a non-string key in the array form', '["a", 1]'],
    ['an empty key', '[""]'],
    ['a policy whose keys are not an array', '{"full": "a"}'],
  ])('throws on %s', (_, raw) => {
    expect(() => parseApiKeys(raw)).toThrow();
  });
});

describe('apiKeyAuth middleware', () => {
  afterEach(() => vi.restoreAllMocks());

  it('rejects a request without x-api-key with the same 401 body as before', async () => {
    const res = await request(appWith('["secret1"]'));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      status: 401,
      message: httpStatus['401_MESSAGE'],
    });
  });

  it('rejects an unknown key', async () => {
    const res = await request(appWith('["secret1"]'), 'secret2');

    expect(res.status).toBe(401);
  });

  it('rejects every key when API_KEYS is unset', async () => {
    const res = await request(appWith(undefined), 'secret1');

    expect(res.status).toBe(401);
  });

  it('accepts a legacy array key and exposes it as the full policy', async () => {
    const res = await request(appWith('["secret1", "secret2"]'), 'secret2');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      policy: FULL_POLICY,
      fingerprint: fingerprintApiKey('secret2'),
    });
  });

  it('accepts an object-form key and exposes its policy', async () => {
    const res = await request(appWith('{"full": ["secret1"]}'), 'secret1');

    expect(res.status).toBe(200);
    expect((await res.json()).policy).toBe(FULL_POLICY);
  });

  it('accepts a key whose secret entry is pre-hashed', async () => {
    const raw = JSON.stringify({
      full: [`sha256:${fingerprintApiKey('secret1')}`],
    });

    const res = await request(appWith(raw), 'secret1');

    expect(res.status).toBe(200);
  });

  it('rejects a key under a policy that is not defined', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(appWith('{"reporting": ["secret1"]}'), 'secret1');

    expect(res.status).toBe(401);
  });

  it('requires a key on /core/public paths too', async () => {
    const res = await request(
      appWith('["secret1"]'),
      undefined,
      '/core/public/anything',
    );

    expect(res.status).toBe(401);
  });
});
