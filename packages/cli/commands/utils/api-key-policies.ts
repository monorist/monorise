import fs from 'node:fs';
import path from 'node:path';

// Set by `defineApiKeyPolicies` in @monorise/base. Reading the validator off
// the policies object runs the same version of it the project's policies were
// written against, without resolving @monorise/base from the project here.
const VALIDATE_API_KEY_POLICIES = Symbol.for('monorise.validateApiKeyPolicies');

/**
 * Resolves `apiKeys` from monorise.config.ts to an absolute path, or
 * `undefined` when the project defines no policies.
 */
export function resolveApiKeysPath(
  projectRoot: string,
  apiKeys: string | undefined,
): string | undefined {
  if (!apiKeys) return undefined;

  const absolutePath = path.resolve(projectRoot, apiKeys);
  if (
    !fs.existsSync(absolutePath) &&
    !fs.existsSync(`${absolutePath}.ts`) &&
    !fs.existsSync(`${absolutePath}.js`)
  ) {
    throw new Error(
      `API key policies file not found: '${absolutePath}'. Please ensure 'apiKeys' in monorise.config.ts points to a valid file.`,
    );
  }
  return absolutePath;
}

/**
 * Validates the project's policies against its entity configs. Runs after
 * config.ts is generated, because a policy file usually imports the generated
 * `Entity` enum.
 */
export async function validateApiKeyPoliciesFile(
  apiKeysPath: string,
  configOutputPath: string,
): Promise<void> {
  const { default: generatedConfig } = await import(configOutputPath);
  const { default: policies } = await import(apiKeysPath);

  const validate = policies?.[VALIDATE_API_KEY_POLICIES];
  if (typeof validate !== 'function') {
    throw new Error(
      `API key policies file at '${apiKeysPath}' must default export the result of defineApiKeyPolicies(...).`,
    );
  }

  const errors: string[] = validate(generatedConfig.EntityConfig);
  if (errors.length) {
    throw new Error(
      `Invalid API key policies in '${apiKeysPath}':\n  - ${errors.join('\n  - ')}`,
    );
  }
  console.log('Validated API key policies.');
}

/**
 * The handle.ts import line for the policies, and the argument to pass to
 * `new CoreFactory(...)`. The policies are imported only by handle.ts, never
 * by config.ts, so a policy file can import the generated `Entity` enum
 * without a circular import.
 */
export function apiKeyPoliciesHandleParts(
  monoriseOutputDir: string,
  apiKeysPath: string | undefined,
): { importLine: string; coreFactoryArg: string } {
  if (!apiKeysPath) return { importLine: '', coreFactoryArg: 'config' };

  const relativePath = path
    .relative(monoriseOutputDir, apiKeysPath)
    .replace(/\.(ts|js|mjs|cjs)$/, '');
  const importPath = relativePath.startsWith('.')
    ? relativePath
    : `./${relativePath}`;

  return {
    importLine: `import apiKeyPolicies from '${importPath}';`,
    coreFactoryArg: '{ ...config, ApiKeyPolicies: apiKeyPolicies }',
  };
}
