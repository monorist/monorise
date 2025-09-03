#!/usr/bin/env node

import 'tsx';
import 'tsconfig-paths/register.js';
import fs from 'node:fs';
import path from 'node:path';
import chokidar from 'chokidar';

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

  let routesImportLine = '';
  let appHandlerPayload = '{}'; // Default to an empty object for appHandler if no custom routes

  if (customRoutesPath) {
    const absoluteCustomRoutesPath = path.resolve(
      projectRoot,
      customRoutesPath,
    );

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
      (typeof routesExport !== 'function' &&
        typeof routesExport !== 'object') ||
      routesExport === null ||
      !(
        'get' in routesExport &&
        'post' in routesExport &&
        'use' in routesExport
      )
    ) {
      throw new Error(
        `Custom routes file at '${absoluteCustomRoutesPath}' must default export an instance of Hono (or an object with .get, .post, .use methods).`,
      );
    }

    let relativePathToRoutes = path.relative(
      monoriseOutputDir,
      absoluteCustomRoutesPath,
    );
    relativePathToRoutes = relativePathToRoutes.replace(
      /\.(ts|js|mjs|cjs)$/,
      '',
    );

    // If custom routes are provided, include the import statement and pass 'routes' to appHandler
    routesImportLine = `import routes from '${relativePathToRoutes}';`;
    appHandlerPayload = '{ routes }';
  }
  // If customRoutesPath is not provided, routesImportLine remains empty and appHandlerPayload remains `{}`

  const combinedContent = `
import CoreFactory from '@monorise/core';
import config from './config';
${routesImportLine ? `${routesImportLine}\n` : ''}const coreFactory = new CoreFactory(config);

export const replicationHandler = coreFactory.replicationProcessor;
export const mutualHandler = coreFactory.mutualProcessor;
export const tagHandler = coreFactory.tagProcessor;
export const treeHandler = coreFactory.prejoinProcessor;
export const appHandler = coreFactory.appHandler(${appHandlerPayload});
`;
  fs.writeFileSync(handleOutputPath, combinedContent);
  console.log('Successfully generated handle.ts!');

  return handleOutputPath;
}

async function generateFiles(rootPath?: string): Promise<string> {
  const baseDir = rootPath ? path.resolve(rootPath) : process.cwd();
  const configFilePathTS = path.join(baseDir, 'monorise.config.ts');
  const configFilePathJS = path.join(baseDir, 'monorise.config.js');

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

  const configDir = path.resolve(projectRoot, monoriseConfig.configDir);
  const monoriseOutputDir = path.join(projectRoot, '.monorise');

  fs.mkdirSync(monoriseOutputDir, { recursive: true });

  await generateConfigFile(configDir, monoriseOutputDir);
  await generateHandleFile(monoriseConfig, projectRoot, monoriseOutputDir);

  return configDir;
}

async function runInitCommand(rootPath?: string) {
  const projectRoot = rootPath ? path.resolve(rootPath) : process.cwd();
  console.log(`Initializing Monorise project in ${projectRoot}...`);

  // 1. Create monorise.config.ts
  const monoriseConfigTsPath = path.join(projectRoot, 'monorise.config.ts');
  const monoriseConfigContent = `
const config = {
  configDir: './monorise/entities',
  // custom route file should export default an Hono object.
  // customRoutes: './path/to/custom/routes.ts'
};

export default config;
`;
  if (!fs.existsSync(monoriseConfigTsPath)) {
    fs.writeFileSync(monoriseConfigTsPath, monoriseConfigContent.trimStart());
    console.log(`Created ${path.relative(projectRoot, monoriseConfigTsPath)}`);
  } else {
    console.log(
      `${path.relative(projectRoot, monoriseConfigTsPath)} already exists. Skipping.`,
    );
  }

  // 2. Create ./monorise/entities/user.ts
  const monoriseEntitiesDir = path.join(projectRoot, 'monorise', 'entities');
  fs.mkdirSync(monoriseEntitiesDir, { recursive: true });

  const userEntityTsPath = path.join(monoriseEntitiesDir, 'user.ts');
  const userEntityContent = `
import { createEntityConfig } from '@monorise/base';
import { z } from 'zod';

const baseSchema = z
  .object({
    displayName: z
      .string()
      .min(1, 'Please provide a name for this user account'),
    firstName: z.string().min(1, 'Please provide first name'),
    lastName: z.string().min(1, 'Please provide last name'),
    jobTitle: z.string(),
  })
  .partial();

const config = createEntityConfig({
  name: 'user',
  baseSchema,
});

export default config;
`;
  if (!fs.existsSync(userEntityTsPath)) {
    fs.writeFileSync(userEntityTsPath, userEntityContent.trimStart());
    console.log(`Created ${path.relative(projectRoot, userEntityTsPath)}`);
  } else {
    console.log(
      `${path.relative(projectRoot, userEntityTsPath)} already exists. Skipping.`,
    );
  }

  // 3. Update package.json
  const packageJsonPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf8');
      const packageJson = JSON.parse(packageJsonContent);

      if (packageJson.type !== 'module') {
        packageJson.type = 'module';
        fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
        console.log(
          `Updated 'type' to 'module' in ${path.relative(projectRoot, packageJsonPath)}`,
        );
      } else {
        console.log(
          `'type: "module"' already set in ${path.relative(projectRoot, packageJsonPath)}. Skipping.`,
        );
      }
    } catch (error) {
      console.error(
        `Error reading or parsing ${path.relative(projectRoot, packageJsonPath)}:`,
        error,
      );
    }
  } else {
    console.warn(
      `Warning: ${path.relative(projectRoot, packageJsonPath)} not found. Cannot update 'type'.`,
    );
  }

  console.log('Monorise initialization complete!');
}

async function runDevCommand(configDir: string, rootPath?: string) {
  console.log(`Watching for changes in ${configDir}...`);
  const watcher = chokidar.watch(configDir, {
    ignored: (watchedPath: string) => {
      const fileName = path.basename(watchedPath);
      return (
        fileName === 'index.ts' || // Old name, still ignore in case it exists
        fileName === 'config.ts' || // Generated config file
        fileName === 'processors.ts' || // Generated processors file
        fileName === 'app.ts' || // Generated app file
        fileName.startsWith('.') ||
        watchedPath.endsWith('.js') ||
        watchedPath.endsWith('.jsx') ||
        watchedPath.endsWith('.d.ts')
      );
    },
    persistent: true,
    ignoreInitial: true,
  });

  watcher.on('add', async (filePath) => {
    console.log(`File ${filePath} has been added. Regenerating...`);
    try {
      await generateFiles(rootPath);
    } catch (err) {
      console.error('Regeneration failed:', err);
    }
  });

  watcher.on('change', async (filePath) => {
    console.log(`File ${filePath} has been changed. Regenerating...`);
    try {
      await generateFiles(rootPath);
    } catch (err) {
      console.error('Regeneration failed:', err);
    }
  });

  watcher.on('unlink', async (filePath) => {
    console.log(`File ${filePath} has been removed. Regenerating...`);
    try {
      await generateFiles(rootPath);
    } catch (err) {
      console.error('Regeneration failed:', err);
    }
  });

  process.on('SIGINT', () => {
    console.log('Monorise dev terminated. Closing watcher and sst dev...');
    watcher.close();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    console.log('Monorise dev terminated. Closing watcher and sst dev...');
    watcher.close();
    process.exit(0);
  });
}

async function runBuildCommand(rootPath?: string) {
  console.log('Starting sst build...');
  await generateFiles(rootPath);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  let rootPath: string | undefined;
  const rootFlagIndex = args.indexOf('--config-root');
  if (rootFlagIndex > -1 && args[rootFlagIndex + 1]) {
    rootPath = args[rootFlagIndex + 1];
  }

  try {
    if (command === 'dev') {
      const configDir = await generateFiles(rootPath);
      await runDevCommand(configDir, rootPath);
    } else if (command === 'build') {
      await runBuildCommand(rootPath);
    } else if (command === 'init') {
      await runInitCommand(rootPath);
    } else {
      console.error(
        'Unknown command. Usage: monorise [dev|build|init] [--root <path>]',
      );
      process.exit(1);
    }
  } catch (err) {
    console.error('Monorise process failed:', err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Monorise encountered an unhandled error:', err);
  process.exit(1);
});
