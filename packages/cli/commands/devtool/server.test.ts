import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { DEFAULT_DEVTOOL_PORT, createDevtoolServer } from './server';

test('devtool uses a browser-safe default port', () => {
  assert.equal(DEFAULT_DEVTOOL_PORT, 6767);
});

test('devtool proxies entity requests without exposing its API key in metadata', async (t) => {
  const requests: {
    method?: string;
    url?: string;
    apiKey?: string;
    body: string;
  }[] = [];
  const upstream = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({
      method: request.method,
      url: request.url,
      apiKey: request.headers['x-api-key'] as string | undefined,
      body,
    });
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify(
        request.method === 'GET'
          ? { data: [], totalCount: 0 }
          : { entityId: 'user-1', data: body ? JSON.parse(body) : {} },
      ),
    );
  });
  await new Promise<void>((resolve) =>
    upstream.listen(0, '127.0.0.1', resolve),
  );
  t.after(
    () =>
      new Promise<void>((resolve) => {
        upstream.close(() => resolve());
      }),
  );
  const upstreamPort = (upstream.address() as AddressInfo).port;

  const devtool = createDevtoolServer({
    apiUrl: `http://127.0.0.1:${upstreamPort}`,
    apiKey: 'server-only-key',
    port: 0,
    entities: [
      {
        name: 'user',
        displayName: 'User',
        searchable: true,
        searchFields: ['name'],
        uniqueFields: [],
        tags: ['active'],
        mutuals: [
          {
            entityType: 'team',
            fields: ['teamIds'],
            dataFields: [],
            createTemplate: {},
          },
        ],
        fields: [],
        createTemplate: {},
      },
      {
        name: 'team',
        displayName: 'Team',
        searchable: false,
        searchFields: [],
        uniqueFields: [],
        tags: [],
        mutuals: [
          {
            entityType: 'user',
            fields: [],
            dataFields: [],
            createTemplate: {},
          },
        ],
        fields: [],
        createTemplate: {},
      },
    ],
  });
  const address = await devtool.listen();
  t.after(devtool.close);

  const meta = await fetch(`${address.url}/api/meta`);
  assert.equal(meta.status, 200);
  assert.doesNotMatch(await meta.text(), /server-only-key/);

  const list = await fetch(
    `${address.url}/api/entities/user?query=Ada&limit=10`,
  );
  assert.equal(list.status, 200);

  const create = await fetch(`${address.url}/api/entities/user`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Ada' }),
  });
  assert.equal(create.status, 200);

  const update = await fetch(`${address.url}/api/entities/user/user-1`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Grace' }),
  });
  assert.equal(update.status, 200);

  const remove = await fetch(`${address.url}/api/entities/user/user-1`, {
    method: 'DELETE',
  });
  assert.equal(remove.status, 200);

  const tagged = await fetch(
    `${address.url}/api/tags/user/active?group=yes&limit=10`,
  );
  assert.equal(tagged.status, 200);

  const mutuals = await fetch(
    `${address.url}/api/mutuals/user/user-1/team?limit=10`,
  );
  assert.equal(mutuals.status, 200);

  const mutual = await fetch(
    `${address.url}/api/mutuals/user/user-1/team/team-1`,
  );
  assert.equal(mutual.status, 200);

  const createMutual = await fetch(
    `${address.url}/api/mutuals/user/user-1/team/team-1`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'owner' }),
    },
  );
  assert.equal(createMutual.status, 200);

  const updateMutual = await fetch(
    `${address.url}/api/mutuals/user/user-1/team/team-1`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'member' }),
    },
  );
  assert.equal(updateMutual.status, 200);

  const deleteMutual = await fetch(
    `${address.url}/api/mutuals/user/user-1/team/team-1`,
    { method: 'DELETE' },
  );
  assert.equal(deleteMutual.status, 200);

  const unknownTag = await fetch(
    `${address.url}/api/tags/user/not-configured?group=yes`,
  );
  assert.equal(unknownTag.status, 404);

  const unknownMutualType = await fetch(
    `${address.url}/api/mutuals/user/user-1/not-configured`,
  );
  assert.equal(unknownMutualType.status, 404);

  assert.deepEqual(
    requests.map(({ method, url, apiKey }) => ({ method, url, apiKey })),
    [
      {
        method: 'GET',
        url: '/core/entity/user?query=Ada&limit=10',
        apiKey: 'server-only-key',
      },
      {
        method: 'POST',
        url: '/core/entity/user',
        apiKey: 'server-only-key',
      },
      {
        method: 'PATCH',
        url: '/core/entity/user/user-1',
        apiKey: 'server-only-key',
      },
      {
        method: 'DELETE',
        url: '/core/entity/user/user-1',
        apiKey: 'server-only-key',
      },
      {
        method: 'GET',
        url: '/core/tag/user/active?group=yes&limit=10',
        apiKey: 'server-only-key',
      },
      {
        method: 'GET',
        url: '/core/mutual/user/user-1/team?limit=10',
        apiKey: 'server-only-key',
      },
      {
        method: 'GET',
        url: '/core/mutual/user/user-1/team/team-1',
        apiKey: 'server-only-key',
      },
      {
        method: 'POST',
        url: '/core/mutual/user/user-1/team/team-1',
        apiKey: 'server-only-key',
      },
      {
        method: 'PATCH',
        url: '/core/mutual/user/user-1/team/team-1',
        apiKey: 'server-only-key',
      },
      {
        method: 'DELETE',
        url: '/core/mutual/user/user-1/team/team-1',
        apiKey: 'server-only-key',
      },
    ],
  );
  assert.equal(requests[1].body, '{"name":"Ada"}');
  assert.equal(requests[2].body, '{"name":"Grace"}');
  assert.equal(requests[7].body, '{"role":"owner"}');
  assert.equal(requests[8].body, '{"role":"member"}');
});

test('devtool rejects unknown entity types before reaching the API', async (t) => {
  const devtool = createDevtoolServer({
    apiUrl: 'http://127.0.0.1:1',
    port: 0,
    entities: [],
  });
  const address = await devtool.listen();
  t.after(devtool.close);

  const response = await fetch(`${address.url}/api/entities/not-configured`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { message: 'Unknown entity type' });
});

test('devtool switches discovered and manual connections without exposing key values', async (t) => {
  const requests: string[] = [];
  const upstream = createServer((request, response) => {
    requests.push(String(request.headers['x-api-key'] ?? ''));
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ data: [], totalCount: 0 }));
  });
  await new Promise<void>((resolve) =>
    upstream.listen(0, '127.0.0.1', resolve),
  );
  t.after(
    () =>
      new Promise<void>((resolve) => {
        upstream.close(() => resolve());
      }),
  );
  const upstreamPort = (upstream.address() as AddressInfo).port;
  const local = {
    id: 'local',
    label: 'Local',
    source: 'local' as const,
  };
  const production = {
    id: 'sst:production',
    label: 'production',
    source: 'sst' as const,
  };
  const apiUrl = `http://127.0.0.1:${upstreamPort}`;
  const devtool = createDevtoolServer({
    port: 0,
    entities: [
      {
        name: 'user',
        displayName: 'User',
        searchable: false,
        searchFields: [],
        uniqueFields: [],
        tags: [],
        mutuals: [],
        fields: [],
        createTemplate: {},
      },
    ],
    connections: {
      stages: [local, production],
      initialStage: local,
      initialConnection: {
        apiUrl,
        keys: [
          {
            id: 'local-fingerprint',
            label: 'Local key',
            value: 'local-secret',
          },
        ],
      },
      resolve: async (stageId) => {
        assert.equal(stageId, production.id);
        return {
          apiUrl,
          keys: [
            {
              id: 'reader-fingerprint',
              label: 'reader · 12345678',
              policy: 'reader',
              value: 'reader-secret',
            },
            {
              id: 'writer-fingerprint',
              label: 'writer · 87654321',
              policy: 'writer',
              value: 'writer-secret',
            },
          ],
        };
      },
    },
  });
  const address = await devtool.listen();
  t.after(devtool.close);

  const initialMetadata = await (await fetch(`${address.url}/api/meta`)).text();
  assert.doesNotMatch(
    initialMetadata,
    /local-secret|reader-secret|writer-secret/,
  );

  const stageResponse = await fetch(`${address.url}/api/connection`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stageId: production.id }),
  });
  assert.equal(stageResponse.status, 200);
  const stageBody = await stageResponse.text();
  assert.match(stageBody, /reader · 12345678/);
  assert.doesNotMatch(stageBody, /local-secret|reader-secret|writer-secret/);

  await fetch(`${address.url}/api/entities/user`);
  const keyResponse = await fetch(`${address.url}/api/connection/key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ keyId: 'writer-fingerprint' }),
  });
  assert.equal(keyResponse.status, 200);
  assert.doesNotMatch(
    await keyResponse.text(),
    /local-secret|reader-secret|writer-secret/,
  );
  await fetch(`${address.url}/api/entities/user`);

  const invalidManualResponse = await fetch(
    `${address.url}/api/connection/manual`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        apiUrl: 'file:///private/core',
        apiKey: 'manual-production-secret',
      }),
    },
  );
  assert.equal(invalidManualResponse.status, 400);
  assert.doesNotMatch(
    await invalidManualResponse.text(),
    /manual-production-secret/,
  );

  const manualResponse = await fetch(`${address.url}/api/connection/manual`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      apiUrl: `${apiUrl}/`,
      apiKey: 'manual-production-secret',
    }),
  });
  assert.equal(manualResponse.status, 200);
  const manualBody = await manualResponse.text();
  assert.match(manualBody, /Manual · [a-f0-9]{8}/);
  assert.match(manualBody, /"stageId":"manual"/);
  assert.doesNotMatch(manualBody, /manual-production-secret/);
  await fetch(`${address.url}/api/entities/user`);

  const manualMetadata = await (await fetch(`${address.url}/api/meta`)).text();
  assert.doesNotMatch(manualMetadata, /manual-production-secret/);

  assert.deepEqual(requests, [
    'reader-secret',
    'writer-secret',
    'manual-production-secret',
  ]);
});
