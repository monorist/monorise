import fs from 'node:fs';
import path from 'node:path';

function kebabToCamel(str: string): string {
  return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function kebabToPascal(kebab: string): string {
  return kebab
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

async function generateConfigFile(
  configDir: string,
  monoriseOutputDir: string,
): Promise<string> {
  const configOutputPath = path.join(monoriseOutputDir, 'config.ts');
  const initialConfigContent = `
export enum Entity {}
`;
  fs.writeFileSync(configOutputPath, initialConfigContent);

  const files = fs
    .readdirSync(configDir)
    .filter((file) => file.endsWith('.ts') && file !== 'index.ts');

  const names = new Set<string>();
  const nameRegex = /^[a-z]+(-[a-z]+)*$/;
  const imports: string[] = [];

  const enumEntries: string[] = [];
  const typeEntries: string[] = [];
  const schemaMapEntries: string[] = [];
  const configEntries: string[] = [];
  const schemaEntries: string[] = [];
  const allowedEntityEntries: string[] = [];
  const entityWithEmailAuthEntries: string[] = [];

  const relativePathToConfigDir = path.relative(monoriseOutputDir, configDir);
  const importPathPrefix = relativePathToConfigDir
    ? `${relativePathToConfigDir}/`
    : './';

  for (const file of files) {
    const fullPath = path.join(configDir, file);
    const module = await import(fullPath);
    const config = module.default;

    if (!nameRegex.test(config.name)) {
      throw new Error(
        `Invalid name format: ${config.name} in ${file}. Must be kebab-case.`,
      );
    }

    if (names.has(config.name)) {
      throw new Error(`Duplicate name found: ${config.name} in ${file}`);
    }
    names.add(config.name);

    const fileName = file.replace(/\.ts$/, '');
    const variableName = kebabToCamel(fileName);
    imports.push(
      `import ${variableName} from '${importPathPrefix}${fileName}';`,
    );

    const enumKey = config.name.toUpperCase().replace(/-/g, '_');
    enumEntries.push(`${enumKey} = '${config.name}'`);
    typeEntries.push(
      `export type ${kebabToPascal(config.name)}Type = z.infer<(typeof ${variableName})['finalSchema']>;`,
    );
    schemaMapEntries.push(
      `[Entity.${enumKey}]: ${kebabToPascal(config.name)}Type;`,
    );

    configEntries.push(`[Entity.${enumKey}]: ${kebabToCamel(config.name)},`);
    schemaEntries.push(
      `[Entity.${enumKey}]: ${kebabToCamel(config.name)}.finalSchema,`,
    );

    allowedEntityEntries.push(`Entity.${enumKey}`);

    if (config.authMethod?.email) {
      entityWithEmailAuthEntries.push(`Entity.${enumKey}`);
    }
  }

  const configOutputContent = `
import type { z } from 'zod';
${imports.join('\n')}

export enum Entity {
  ${enumEntries.join(',\n  ')}
}

${typeEntries.join('\n')}

export interface EntitySchemaMap {
  ${schemaMapEntries.join('\n  ')}
}

const EntityConfig = {
  ${configEntries.join('\n  ')}
};

const FormSchema = {
  ${schemaEntries.join('\n  ')}
};

const AllowedEntityTypes = [
  ${allowedEntityEntries.join(',\n  ')}
];

const EmailAuthEnabledEntities = [${entityWithEmailAuthEntries.join(', ')}];

export {
  EntityConfig,
  FormSchema,
  AllowedEntityTypes,
  EmailAuthEnabledEntities,
};

const config = {
  EntityConfig,
  FormSchema,
  AllowedEntityTypes,
  EmailAuthEnabledEntities,
};

export default config;

declare module '@monorise/base' {
  export enum Entity {
    ${enumEntries.join(',\n    ')}
  }

  ${typeEntries.join('\n  ')}

  export interface EntitySchemaMap {
    ${schemaMapEntries.join('\n    ')}
  }
}
`;

  fs.writeFileSync(configOutputPath, configOutputContent);
  console.log('Successfully generated config.ts!');
  return configOutputPath;
}

async function generateHandleFile(
  monoriseConfig: { customRoutes?: string; configDir: string },
  projectRoot: string,
  monoriseOutputDir: string,
): Promise<string> {
  const handleOutputPath = path.join(monoriseOutputDir, 'handle.ts');
  const customRoutesPath = monoriseConfig.customRoutes;

  if (!customRoutesPath) {
    throw new Error(
      "monorise.config.ts must define 'customRoutes' (e.g., './src/app') for handle.ts generation.",
    );
  }

  const absoluteCustomRoutesPath = path.resolve(projectRoot, customRoutesPath);

  if (
    !fs.existsSync(absoluteCustomRoutesPath) &&
    !fs.existsSync(`${absoluteCustomRoutesPath}.ts`) &&
    !fs.existsSync(`${absoluteCustomRoutesPath}.js`)
  ) {
    throw new Error(
      `Custom routes file not found: '${absoluteCustomRoutesPath}'. Please ensure 'customRoutes' in monorise.config.ts points to a valid file.`,
    );
  }

  let routesModule;
  try {
    routesModule = await import(absoluteCustomRoutesPath);
  } catch (e: any) {
    throw new Error(
      `Failed to load custom routes file at '${absoluteCustomRoutesPath}'. Ensure it's a valid JavaScript/TypeScript module. Error: ${e.message}`,
    );
  }

  const routesExport = routesModule.default;

  if (
    !routesExport ||
    (typeof routesExport !== 'function' && typeof routesExport !== 'object') ||
    routesExport === null ||
    !('get' in routesExport && 'post' in routesExport && 'use' in routesExport)
  ) {
    throw new Error(
      `Custom routes file at '${absoluteCustomRoutesPath}' must default export an instance of Hono (or an object with .get, .post, .use methods).`,
    );
  }

  let relativePathToRoutes = path.relative(
    monoriseOutputDir,
    absoluteCustomRoutesPath,
  );
  relativePathToRoutes = relativePathToRoutes.replace(/\.(ts|js|mjs|cjs)$/, '');

  const combinedContent = `
import { AppHandler, CoreFactory } from '@monorise/core';
import config from './config';
import routes from '${relativePathToRoutes}';

const coreFactory = new CoreFactory(config);

export const replicationHandler = coreFactory.replicationProcessor;
export const mutualHandler = coreFactory.mutualProcessor;
export const tagHandler = coreFactory.tagProcessor;
export const treeHandler = coreFactory.treeProcessor;
export const appHandler = AppHandler({
  config,
  routes
});
`;
  fs.writeFileSync(handleOutputPath, combinedContent);
  console.log('Successfully generated handle.ts!');

  return handleOutputPath;
}

async function generateFiles(): Promise<string> {
  const configFilePathTS = path.resolve('./monorise.config.ts');
  const configFilePathJS = path.resolve('./monorise.config.js');

  let configFilePath: string;
  if (fs.existsSync(configFilePathTS)) {
    configFilePath = configFilePathTS;
  } else if (fs.existsSync(configFilePathJS)) {
    configFilePath = configFilePathJS;
  } else {
    throw new Error(
      'Neither monorise.config.ts nor monorise.config.js found in the root of the project.',
    );
  }

  const projectRoot = path.dirname(configFilePath);
  const monoriseConfigModule = await import(configFilePath);
  const monoriseConfig = monoriseConfigModule.default;

  const configDir = path.resolve(monoriseConfig.configDir);
  const monoriseOutputDir = path.join(projectRoot, '.monorise');

  fs.mkdirSync(monoriseOutputDir, { recursive: true });

  await generateConfigFile(configDir, monoriseOutputDir);
  await generateHandleFile(monoriseConfig, projectRoot, monoriseOutputDir);

  return configDir;
}

export default generateFiles;
