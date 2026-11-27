import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type SstRunner,
  parseApiKeys,
  parseSecretList,
  parseShellDiscovery,
  parseStageList,
  resolveSstStage,
} from './sst';

function shellOutput(value: unknown) {
  return [
    'SST 4.7.3 ready!',
    `__MONORISE_DEVTOOL__${Buffer.from(JSON.stringify(value)).toString('base64')}`,
    '',
  ].join('\n');
}

test('parses deployed SST stages and excludes the undeployed current stage', () => {
  const output = [
    '\u001B[1m  App:\u001B[0m       example',
    '\u001B[1m  Stages:\u001B[0m   dev',
    '            production',
    '            preview-12',
    '            local (not deployed)',
    '',
  ].join('\n');

  assert.deepEqual(parseStageList(output), ['dev', 'production', 'preview-12']);
  assert.deepEqual(parseStageList('  Stages: devtool (not deployed)\n'), []);
});

test('parses API_KEYS from SST secret output with stage values overriding fallback', () => {
  const output = [
    '# fallback',
    'API_KEYS={"default":["fallback-key"]}',
    'OTHER=value',
    '',
    '# example/production',
    'API_KEYS={',
    '  "reader": ["reader-key"],',
    '  "writer": ["writer-key"]',
    '}',
    '',
  ].join('\n');

  assert.equal(
    parseSecretList(output),
    [
      '{',
      '  "reader": ["reader-key"],',
      '  "writer": ["writer-key"]',
      '}',
    ].join('\n'),
  );
});

test('creates safe labels for scoped API keys and skips pre-hashed keys', () => {
  const parsed = parseApiKeys(
    JSON.stringify({
      reader: ['reader-secret', 'sha256:already-hashed'],
      writer: ['writer-secret'],
    }),
  );

  assert.equal(parsed.hashedCount, 1);
  assert.deepEqual(
    parsed.keys.map(({ label, policy }) => ({ label, policy })),
    [
      { label: 'reader · f03319de', policy: 'reader' },
      { label: 'writer · ef80202e', policy: 'writer' },
    ],
  );
  assert.deepEqual(
    parseApiKeys(JSON.stringify(['first', 'second'])).keys.map(
      ({ policy }) => policy,
    ),
    ['full', 'full'],
  );
});

test('parses the Monorise discovery marker from noisy SST shell output', () => {
  assert.deepEqual(
    parseShellDiscovery(
      shellOutput({
        apis: [{ name: 'core', url: 'https://api.example.com' }],
        apiKeys: '["fallback-key"]',
      }),
    ),
    {
      apiUrl: 'https://api.example.com/',
      apiKeys: '["fallback-key"]',
    },
  );
});

test('resolves a stage API and prefers current SST secret values', async () => {
  const calls: string[][] = [];
  const runner: SstRunner = async (args) => {
    calls.push(args);
    if (args[0] === 'shell') {
      return shellOutput({
        apis: [{ name: 'core', url: 'https://api.example.com/' }],
        apiKeys: '{"default":["deployed-default"]}',
      });
    }
    return [
      '# fallback',
      'API_KEYS={"default":["fallback-key"]}',
      '',
      '# example/production',
      'API_KEYS={"reader":["stage-key"]}',
      '',
    ].join('\n');
  };

  const resolved = await resolveSstStage('/project', 'production', runner);

  assert.equal(resolved.apiUrl, 'https://api.example.com/');
  assert.deepEqual(
    resolved.keys.map(({ policy, value }) => ({ policy, value })),
    [{ policy: 'reader', value: 'stage-key' }],
  );
  assert.deepEqual(calls[0].slice(0, 3), ['shell', '--stage', 'production']);
  assert.deepEqual(calls[1], ['secret', 'list', '--stage', 'production']);
});
