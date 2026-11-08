import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  apiKeyPoliciesHandleParts,
  resolveApiKeysPath,
  validateApiKeyPoliciesFile,
} from './api-key-policies';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Inside the package tree, like generate.test.ts, so fixture imports of `zod`
// and of @monorise/base's source resolve through the monorepo.
function makeFixtureDir() {
  const root = path.join(
    dirname,
    `.api-keys-test-fixture-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  fs.mkdirSync(root, { recursive: true });
  return root;
}

// base's utils, not its index: the index imports types as values, which tsx
// rejects at runtime.
const BASE_UTILS = '../../../../base/utils';
const BASE_POLICY_UTILS = '../../../../base/utils/api-key-policy';

function writeGeneratedConfig(root: string) {
  const configPath = path.join(root, 'config.ts');
  fs.writeFileSync(
    configPath,
    `
    import { z } from 'zod';
    import { createEntityConfig } from '${BASE_UTILS}';
    const course = createEntityConfig({
      name: 'course',
      displayName: 'Course',
      baseSchema: z.object({ title: z.string() }).partial(),
      createSchema: z.object({ title: z.string() }),
    });
    export default { EntityConfig: { course } };
    `,
  );
  return configPath;
}

function writePolicies(root: string, body: string) {
  const policiesPath = path.join(root, 'api-keys.ts');
  fs.writeFileSync(policiesPath, body);
  return policiesPath;
}

test('resolveApiKeysPath returns undefined when apiKeys is not set', () => {
  assert.equal(
    resolveApiKeysPath('/project', undefined, '/project/monorise/configs'),
    undefined,
  );
});

test('resolveApiKeysPath resolves an extensionless path to an existing .ts file', () => {
  const root = makeFixtureDir();
  try {
    fs.writeFileSync(path.join(root, 'api-keys.ts'), 'export default {};');
    assert.equal(
      resolveApiKeysPath(root, './api-keys', path.join(root, 'configs')),
      path.join(root, 'api-keys'),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveApiKeysPath throws when the file does not exist', () => {
  assert.throws(
    () => resolveApiKeysPath('/project', './missing', '/project/configs'),
    /API key policies file not found: '\/project\/missing'/,
  );
});

test('resolveApiKeysPath rejects a policy file inside configDir', () => {
  const root = makeFixtureDir();
  try {
    const configDir = path.join(root, 'configs');
    fs.mkdirSync(configDir);
    fs.writeFileSync(path.join(configDir, 'api-keys.ts'), 'export default {};');

    assert.throws(
      () => resolveApiKeysPath(root, './configs/api-keys', configDir),
      /is inside configDir .* where every file is loaded as an entity config/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('apiKeyPoliciesHandleParts passes config unchanged when there are no policies', () => {
  assert.deepEqual(apiKeyPoliciesHandleParts('/project/.monorise', undefined), {
    importLine: '',
    coreFactoryArg: 'config',
  });
});

test('apiKeyPoliciesHandleParts imports the policies relative to .monorise', () => {
  assert.deepEqual(
    apiKeyPoliciesHandleParts(
      '/project/.monorise',
      '/project/monorise/api-keys.ts',
    ),
    {
      importLine: "import apiKeyPolicies from '../monorise/api-keys';",
      coreFactoryArg: '{ ...config, ApiKeyPolicies: apiKeyPolicies }',
    },
  );
});

test('validateApiKeyPoliciesFile accepts valid policies', async () => {
  const root = makeFixtureDir();
  try {
    const configPath = writeGeneratedConfig(root);
    const policiesPath = writePolicies(
      root,
      `
      import { defineApiKeyPolicies } from '${BASE_POLICY_UTILS}';
      export default defineApiKeyPolicies({
        reporting: 'read',
        editor: { entities: { course: { read: '*', create: ['title'] } } },
      });
      `,
    );

    await validateApiKeyPoliciesFile(policiesPath, configPath);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('validateApiKeyPoliciesFile lists every problem in the policies', async () => {
  const root = makeFixtureDir();
  try {
    const configPath = writeGeneratedConfig(root);
    const policiesPath = writePolicies(
      root,
      `
      import { defineApiKeyPolicies } from '${BASE_POLICY_UTILS}';
      export default defineApiKeyPolicies({
        editor: { entities: { course: { read: ['titel'] }, lesson: 'read' } },
      });
      `,
    );

    await assert.rejects(
      () => validateApiKeyPoliciesFile(policiesPath, configPath),
      (error: Error) => {
        assert.match(error.message, /Invalid API key policies in/);
        assert.match(error.message, /course\.read: unknown field 'titel'/);
        assert.match(error.message, /unknown entity type 'lesson'/);
        return true;
      },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('validateApiKeyPoliciesFile requires the result of defineApiKeyPolicies', async () => {
  const root = makeFixtureDir();
  try {
    const configPath = writeGeneratedConfig(root);
    const policiesPath = writePolicies(
      root,
      `export default { reporting: 'read' };`,
    );

    await assert.rejects(
      () => validateApiKeyPoliciesFile(policiesPath, configPath),
      /must default export the result of defineApiKeyPolicies/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
