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
  configDir: string,
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

  // Every file in configDir is loaded as an entity config, so a policy file
  // there would be read as an entity named 'undefined'.
  const fromConfigDir = path.relative(configDir, absolutePath);
  if (!fromConfigDir.startsWith('..') && !path.isAbsolute(fromConfigDir)) {
    throw new Error(
      `API key policies file '${absolutePath}' is inside configDir '${configDir}', where every file is loaded as an entity config. Move it outside, e.g. './monorise/api-keys.ts'.`,
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
): Promise<Record<string, unknown>> {
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
  return policies;
}

/**
 * Declares every custom route permission the policies grant, by augmenting
 * `ApiKeyRoutePermissions` in @monorise/base, so `requires()` only accepts
 * names some policy grants. Appended to config.ts.
 */
export function routePermissionDeclarations(
  policies: Record<string, unknown>,
  baseModuleNames: string[],
): string {
  const permissions = new Set<string>();
  for (const policy of Object.values(policies)) {
    const routes = (policy as { routes?: unknown })?.routes;
    if (Array.isArray(routes)) {
      for (const permission of routes) permissions.add(permission);
    }
  }
  if (permissions.size === 0) return '';

  const members = [...permissions]
    .sort()
    .map((permission) => `    ${JSON.stringify(permission)}: true;`)
    .join('\n');
  return baseModuleNames
    .map(
      (moduleName) => `
declare module '${moduleName}' {
  interface ApiKeyRoutePermissions {
${members}
  }
}
`,
    )
    .join('');
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
