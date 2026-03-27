#!/usr/bin/env node

import 'tsx';
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';
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

function execCommand(
  command: string,
  cwd?: string,
  stdio: 'inherit' | 'pipe' = 'inherit',
): void {
  console.log(`Running: ${command}`);
  execSync(command, { cwd, stdio });
}

async function generateConfigFile(
  configDir: string,
  monoriseOutputDir: string,
  projectRoot: string,
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

  // Detect whether the consumer uses the combined 'monorise' package or scoped '@monorise/*' packages
  const usesCombinedPackage = fs.existsSync(path.join(projectRoot, 'node_modules', 'monorise'));
  const baseModuleName = usesCombinedPackage ? 'monorise/base' : '@monorise/base';

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

const EmailAuthEnabledEntities: Entity[] = [${entityWithEmailAuthEntries.join(', ')}];

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

declare module '${baseModuleName}' {
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
      routesExport === null ||
      (typeof routesExport === 'object' &&
        !(
          'get' in routesExport &&
          'post' in routesExport &&
          'use' in routesExport
        ))
    ) {
      throw new Error(
        `Custom routes file at '${absoluteCustomRoutesPath}' must default export an instance of Hono (or an object with .get, .post, .use methods). Or a function that consume the dependency container provided by route handler.`,
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

  // Detect whether the consumer uses the combined 'monorise' package or scoped '@monorise/*' packages
  const usesCombinedPackage = fs.existsSync(path.join(projectRoot, 'node_modules', 'monorise'));
  const coreImportPath = usesCombinedPackage ? 'monorise/core' : '@monorise/core';

  const combinedContent = `
import CoreFactory from '${coreImportPath}';
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

  await generateConfigFile(configDir, monoriseOutputDir, projectRoot);
  await generateHandleFile(monoriseConfig, projectRoot, monoriseOutputDir);

  return configDir;
}

const MONORISE_LOGO = `



                                     ░░░░░░░
                                 ░░▒▒▒░░░░░░▒▒▒░
                               ░▒▒░           ░▒▒░
                             ░▒▒░               ░▒▒░
                            ░▒░                   ░▒▒░
                          ░▒▒░                      ▒▒▒░
                        ░▒░░░▒░                    ░▒░░▒▒░
                      ░▒▒░ ░▒▒▒░                  ░▒▒░  ░▒░░
                    ░▒▒  ░▒▒░ ░▒▒░              ░▒░  ░▒░  ░▒░
                  ░▒▒░  ░▒░  ░▒░░▒▒░░░      ░░▒▒░░▒░  ░▒▒   ░▒░
                ░░▒░  ░▒░   ░▒░  ░▒▒░░▒▒▒▒▒▒░░▒░  ░▒░░  ░▒░   ░▒░
               ░▒░  ░░▒░   ░▒░  ░░░  ░▒░  ░░  ░▒░   ░▒░  ░▒░░  ░░▒░
             ░▒░   ░▒░   ░▒░    ░▒   ░░   ░▒░  ░▒░   ░▒░   ░▒░   ░░░░
           ░░░   ░░░░   ░░░    ░░    ▒░   ░░░   ░░░   ░░░    ░░░   ░░░░
         ░░░   ░░░░    ░░░    ░░░   ░░░    ░░    ░░░    ░░░   ░░░    ░░░░
       ░░░    ░░░    ░░░     ░░░    ░░     ░░     ░░░    ░░░    ░░░    ░░░
      ░░░   ░░░░    ░░░     ░░░     ░░     ░░░     ░░     ░░░    ░░░     ░░░
     ░░    ░░░    ░░░      ░░░     ░░░      ░░     ░░░      ░░░    ░░░    ░░░
    ░░    ░░      ░░       ░░      ░░       ░░░     ░░░      ░░░    ░░░░   ░░░
                                  ░░░        ░░      ░░░      ░░░     ░░░
    ░░░░░▒░░░░░░░░░▒░░░░░░░░░      ░         ░░       ░░░       ░░░     ░░
    ░░░                    ░░░░░░░░░         ░░░       ░░░
    ░░░                           ░░░░░░      ░░            ░░░░░▒░░░░░░▒░░░░
     ░░░░░░░░░░░░░░░░░                 ░░░░░          ░░░░░░░░            ░░
      ░░░░░░░     ░░░░░░░░░░░░░░           ░░░░    ░░░░░                ░▒░
        ░░░                   ░░░░░░░         ░░░░░░             ░░░░░░░░
          ░░░░░░░░░░░░              ░░░░░░   ░░░░         ░░░░░░░░░░░░░
            ░▒▒░░░░░░░░░░░▒▒░░          ░░▒▒▒░░       ░▒▒░░       ░░░░
              ░▒░            ░░▒▒░        ░▒░      ░▒▒░         ░░▒░
                ░▒░    ░░░░▒▒▒▒▒▒▒▒▒▒░░ ░▒░      ▒▒░        ░░▒▒▒░
                 ░▒▒▒▒▒░░░          ░░░▒▒▒▒▒░  ▒▒░      ░▒▒▒▒▒▒░
                   ░▒▒░                     ░▒▒▒▒     ▒▒▒  ▒▒▒
                     ░▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒░░         ░▒▒▒▒▒░  ░▒▒
                       ▒▒▒          ░░▒▒▒▒▒▒░      ▒▒▒ ░▒▒
                         ▒▒▒               ░▒▒▒▒    ░▒▒▒░
                           ▒▓▓▓▒▒▒▓▓▒▒▒░       ▒▒▒░░▒▒░
                             ▒▓░      ░▒▒▓▓▒░    ▒▓▓░
                              ░▒▓░         ░▒▓▒░▒▓▒
                                ░▒▓▒░       ░▒▓▓▒
                                   ░▒▒▓▓▓▓▓▓▒▒░



`;

// Template for services/core/routes.ts
const CORE_ROUTES_TEMPLATE = `import { Hono } from 'hono';
import { DependencyContainer } from 'monorise/core';
import config, { Entity } from '#/monorise/config';

const container = new DependencyContainer(config);

const app = new Hono();

app.get('/health', async (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/test', async (c) => {
  // Example: List users using the entity repository
  const entities = await container.entityRepository.listEntities({
    entityType: Entity.USER,
  });

  return c.json({ items: entities.items }, 200);
});

export default app;
`;

// Template for root tsconfig.json
const ROOT_TSCONFIG_TEMPLATE = {
  compilerOptions: {
    target: 'ES2017',
    lib: ['dom', 'dom.iterable', 'esnext'],
    allowJs: true,
    skipLibCheck: true,
    strict: true,
    noEmit: true,
    esModuleInterop: true,
    module: 'esnext',
    moduleResolution: 'bundler',
    resolveJsonModule: true,
    isolatedModules: true,
    jsx: 'react-jsx',
    incremental: true,
    paths: {
      '#/monorise/*': ['./.monorise/*'],
    },
  },
  include: ['**/*.ts', '**/*.tsx'],
  exclude: ['node_modules', 'sst.config.ts'],
};

// Template for monorise.config.ts
const MONORISE_CONFIG_TEMPLATE = `const config = {
  configDir: './monorise/configs',
  // custom routes should export default a Hono object.
  customRoutes: './services/core/routes.ts',
};

export default config;
`;

// Template for starter entity
const USER_ENTITY_TEMPLATE = `import { createEntityConfig } from 'monorise/base';
import { z } from 'zod';

const baseSchema = z
  .object({
    displayName: z.string().min(1, 'Display name is required'),
    email: z.string().email('Valid email is required'),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
  })
  .partial();

const createSchema = z.object({
  displayName: z.string().min(1, 'Display name is required'),
  email: z.string().email('Valid email is required'),
});

const config = createEntityConfig({
  name: 'user',
  displayName: 'User',
  baseSchema,
  createSchema,
  searchableFields: ['displayName', 'email'],
  uniqueFields: ['email'],
});

export default config;
`;

// Template for example Next.js page demonstrating monorise/react hooks
const EXAMPLE_PAGE_TEMPLATE = `'use client';

import { useState } from 'react';
import { useEntities, createEntity } from 'monorise/react';
import { Entity } from '#/monorise/config';

export default function Home() {
  const { entities: users, isLoading } = useEntities(Entity.USER);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName || !email) return;

    setIsCreating(true);
    try {
      await createEntity(Entity.USER, {
        displayName,
        email,
      });
      // The list automatically updates via the store!
      // Clear form
      setDisplayName('');
      setEmail('');
    } catch (error) {
      console.error('Failed to create user:', error);
      alert('Failed to create user. Check console for details.');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <main className="min-h-screen p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">Monorise Demo</h1>

      {/* Create User Form */}
      <section className="mb-8 p-6 border rounded-lg bg-gray-50">
        <h2 className="text-xl font-semibold mb-4">Create User</h2>
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3 py-2 border rounded"
              placeholder="John Doe"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border rounded"
              placeholder="john@example.com"
              required
            />
          </div>
          <button
            type="submit"
            disabled={isCreating}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {isCreating ? 'Creating...' : 'Create User'}
          </button>
        </form>
      </section>

      {/* Users List */}
      <section className="p-6 border rounded-lg">
        <h2 className="text-xl font-semibold mb-4">Users</h2>
        {isLoading ? (
          <p>Loading...</p>
        ) : users && users.length > 0 ? (
          <ul className="space-y-2">
            {users.map((user) => (
              <li key={user.entityId} className="p-3 bg-white border rounded">
                <p className="font-medium">{user.data.displayName}</p>
                <p className="text-sm text-gray-600">{user.data.email}</p>
                <p className="text-xs text-gray-400 mt-1">ID: {user.entityId}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-gray-500">No users yet. Create one above!</p>
        )}
      </section>
    </main>
  );
}
`;

async function runInitCommand(rootPath?: string) {
  console.log(MONORISE_LOGO);

  // Determine project name and root
  let projectName = 'my-app';
  let projectRoot: string;

  if (rootPath) {
    projectRoot = path.resolve(rootPath);
    projectName = path.basename(projectRoot);
  } else {
    // Prompt for project name (simple approach for now)
    const args = process.argv.slice(2);
    const nameIndex = args.indexOf('--name');
    if (nameIndex > -1 && args[nameIndex + 1]) {
      projectName = args[nameIndex + 1];
    }
    projectRoot = path.resolve(projectName);
  }

  console.log(`\n🚀 Creating Monorise project: ${projectName}\n`);

  // Check if directory exists
  if (fs.existsSync(projectRoot)) {
    console.error(`Error: Directory ${projectName} already exists.`);
    process.exit(1);
  }

  // Step 1: Create project directory structure
  console.log('📁 Creating project structure...');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'apps'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'services', 'core'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'monorise', 'configs'), { recursive: true });

  // Step 2: Create root package.json
  console.log('📦 Initializing root package.json...');
  const rootPackageJson = {
    name: projectName,
    version: '0.0.0',
    type: 'module',
    private: true,
    workspaces: ['apps/*', 'services/*'],
  };
  fs.writeFileSync(
    path.join(projectRoot, 'package.json'),
    JSON.stringify(rootPackageJson, null, 2),
  );

  // Step 3: Create root tsconfig.json
  console.log('⚙️  Creating root tsconfig.json...');
  fs.writeFileSync(
    path.join(projectRoot, 'tsconfig.json'),
    JSON.stringify(ROOT_TSCONFIG_TEMPLATE, null, 2),
  );

  // Step 4: Create Next.js app in apps/web
  console.log('\n📱 Creating Next.js app in apps/web...');
  const nextAppDir = path.join(projectRoot, 'apps', 'web');
  try {
    execCommand(
      `npx create-next-app@latest web --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --no-turbopack --yes`,
      path.join(projectRoot, 'apps'),
    );
  } catch (error) {
    console.error('Failed to create Next.js app:', error);
    process.exit(1);
  }

  // Step 5: Install SST v3
  console.log('\n☁️  Installing SST v3...');
  try {
    execCommand('npm install sst@3.19.3 --save-dev', projectRoot);
  } catch (error) {
    console.error('Failed to install SST:', error);
    process.exit(1);
  }

  // Step 6: Install dependencies
  console.log('\n📦 Installing dependencies (monorise, hono, zod)...');
  try {
    execCommand('npm install monorise hono zod', projectRoot);
  } catch (error) {
    console.error('Failed to install dependencies:', error);
    process.exit(1);
  }

  // Step 7: Create monorise.config.ts
  console.log('⚙️  Creating monorise.config.ts...');
  fs.writeFileSync(
    path.join(projectRoot, 'monorise.config.ts'),
    MONORISE_CONFIG_TEMPLATE,
  );

  // Step 9: Create starter entity
  console.log('👤 Creating starter User entity...');
  fs.writeFileSync(
    path.join(projectRoot, 'monorise', 'configs', 'user.ts'),
    USER_ENTITY_TEMPLATE,
  );

  // Step 10: Create services/core/routes.ts
  console.log('🔧 Creating services/core/routes.ts...');
  fs.writeFileSync(
    path.join(projectRoot, 'services', 'core', 'routes.ts'),
    CORE_ROUTES_TEMPLATE,
  );

  // Step 11: Create services package.json
  const servicesPackageJson = {
    name: '@my-app/services',
    version: '0.0.0',
    type: 'module',
  };
  fs.writeFileSync(
    path.join(projectRoot, 'services', 'core', 'package.json'),
    JSON.stringify(servicesPackageJson, null, 2),
  );

  // Step 12: Create sst.config.ts with monorise
  console.log('⚙️  Creating sst.config.ts with Monorise...');
  const sstConfigPath = path.join(projectRoot, 'sst.config.ts');
  const sstConfigContent = `/// <reference path='./.sst/platform/config.d.ts' />

export default $config({
  app(input) {
    return {
      name: '${projectName}',
      removal: input?.stage === 'production' ? 'retain' : 'remove',
      protect: ['production'].includes(input?.stage),
      home: 'aws',
    };
  },
  async run() {
    const { monorise } = await import('monorise/sst');

    const { api } = new monorise.module.Core('core', {
      allowOrigins: ['http://localhost:3000'],
    });

    new sst.aws.Nextjs('web', {
      path: 'apps/web',
      environment: {
        API_BASE_URL: api.url,
      },
    });
  },
});
`;
  fs.writeFileSync(sstConfigPath, sstConfigContent);

  // Step 13: Install SST providers (after sst.config.ts exists)
  console.log('\n☁️  Installing SST providers...');
  try {
    execCommand('npx sst install', projectRoot);
  } catch (error) {
    console.warn('Warning: SST install failed, continuing anyway...');
  }

  // Step 14: Create example page in apps/web
  console.log('📄 Creating example page in apps/web...');
  const webSrcAppDir = path.join(projectRoot, 'apps', 'web', 'src', 'app');
  const webAppDir = path.join(projectRoot, 'apps', 'web', 'app');
  const pagePath = fs.existsSync(webSrcAppDir)
    ? path.join(webSrcAppDir, 'page.tsx')
    : fs.existsSync(webAppDir)
      ? path.join(webAppDir, 'page.tsx')
      : null;

  if (pagePath) {
    try {
      fs.writeFileSync(pagePath, EXAMPLE_PAGE_TEMPLATE);
      console.log(`Created example page at ${path.relative(projectRoot, pagePath)}`);
    } catch (error) {
      console.warn('Warning: Could not create example page:', error);
    }
  } else {
    console.warn('Warning: Could not find apps/web/src/app or apps/web/app directory');
  }

  // Step 15: Update apps/web tsconfig.json with monorise path alias
  console.log('⚙️  Updating apps/web tsconfig.json...');
  const webTsconfigPath = path.join(projectRoot, 'apps', 'web', 'tsconfig.json');
  if (fs.existsSync(webTsconfigPath)) {
    try {
      const webTsconfigContent = fs.readFileSync(webTsconfigPath, 'utf8');
      const webTsconfig = JSON.parse(webTsconfigContent);

      if (!webTsconfig.compilerOptions) {
        webTsconfig.compilerOptions = {};
      }
      if (!webTsconfig.compilerOptions.paths) {
        webTsconfig.compilerOptions.paths = {};
      }

      // Add monorise path alias
      webTsconfig.compilerOptions.paths['#/monorise/*'] = ['../../.monorise/*'];

      fs.writeFileSync(webTsconfigPath, JSON.stringify(webTsconfig, null, 2));
    } catch (error) {
      console.warn('Warning: Could not update apps/web tsconfig.json:', error);
    }
  }

  // Step 16: Run initial monorise build to generate .monorise files
  console.log('\n🔨 Running initial Monorise build...');
  try {
    execCommand('npx monorise build', projectRoot);
  } catch (error) {
    console.warn('Warning: Initial monorise build failed. You can run it manually later.');
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ Monorise project created successfully!');
  console.log('='.repeat(60));
  console.log(`\n📁 Project structure:`);
  console.log(`  ${projectName}/`);
  console.log(`  ├── apps/web/           # Next.js frontend`);
  console.log(`  ├── services/core/      # Backend routes (Hono)`);
  console.log(`  ├── monorise/configs/   # Entity definitions`);
  console.log(`  └── .monorise/          # Generated files`);
  console.log(`\n📂 Where to start coding:`);
  console.log(`  • Edit your data model → monorise/configs/user.ts`);
  console.log(`    (Add fields like phone, role, status to the User entity)`);
  console.log(`  • Build your UI → apps/web/src/app/page.tsx`);
  console.log(`    (React components using useEntities and createEntity)`);
  console.log(`  • Add backend logic → services/core/routes.ts`);
  console.log(`    (Custom API endpoints with Hono)`);
  console.log(`\n🚀 Next steps:`);
  console.log(`  cd ${projectName}`);
  console.log(`  npx sst dev`);
  console.log('\n📚 Documentation: https://monorise.dev');
  console.log('');
}

async function runDevCommand(configDir: string, rootPath?: string) {
  console.log(MONORISE_LOGO);
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
        'Unknown command. Usage: monorise [dev|build|init] [--config-root <path>] [--name <project-name>]',
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
