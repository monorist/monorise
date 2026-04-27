#!/usr/bin/env node

import 'tsx';
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';
import chokidar from 'chokidar';
import { fileURLToPath } from 'node:url';
import { detectCombinedPackage } from './commands/utils/detect-package';
import { ROOT_TSCONFIG_TEMPLATE } from './templates/root-tsconfig';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES_DIR = path.join(__dirname, 'templates', 'files');

function readTemplate(filename: string): string {
  return fs.readFileSync(path.join(TEMPLATES_DIR, filename), 'utf-8');
}

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
  const usesCombinedPackage = detectCombinedPackage(projectRoot);

  // Build module augmentation block
  const augmentationBlock = (moduleName: string) => `
declare module '${moduleName}' {
  export enum Entity {
    ${enumEntries.join(',\n    ')}
  }

  ${typeEntries.join('\n  ')}

  export interface EntitySchemaMap {
    ${schemaMapEntries.join('\n    ')}
  }
}`;

  // Augment the correct module based on which package is installed
  const moduleAugmentations = usesCombinedPackage
    ? augmentationBlock('monorise/base')
    : augmentationBlock('@monorise/base');

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
${moduleAugmentations}
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
  const usesCombinedPackage = detectCombinedPackage(projectRoot);
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
      `npx create-next-app@latest web --typescript --tailwind --eslint --app --no-src-dir --import-alias "#/*" --no-turbopack --yes`,
      path.join(projectRoot, 'apps'),
    );
  } catch (error) {
    console.error('Failed to create Next.js app:', error);
    process.exit(1);
  }

  // Step 5: Install SST v3
  console.log('\n☁️  Installing SST v4...');
  try {
    execCommand('npm install sst@^4 --save-dev', projectRoot);
  } catch (error) {
    console.error('Failed to install SST:', error);
    process.exit(1);
  }

  // Step 6: Install dependencies
  console.log('\n📦 Installing dependencies (monorise, hono, zod, shadcn utilities)...');
  try {
    execCommand('npm install monorise hono zod clsx class-variance-authority radix-ui lucide-react tailwind-merge react-hook-form @hookform/resolvers', projectRoot);
  } catch (error) {
    console.error('Failed to install dependencies:', error);
    process.exit(1);
  }

  // Step 7: Create monorise.config.ts
  console.log('⚙️  Creating monorise.config.ts...');
  fs.writeFileSync(
    path.join(projectRoot, 'monorise.config.ts'),
    readTemplate('monorise.config.ts'),
  );

  // Step 9: Create starter entity
  console.log('👤 Creating starter User entity...');
  fs.writeFileSync(
    path.join(projectRoot, 'monorise', 'configs', 'user.ts'),
    readTemplate('user-entity.ts'),
  );

  // Step 10: Create services/core/routes.ts
  console.log('🔧 Creating services/core/routes.ts...');
  fs.writeFileSync(
    path.join(projectRoot, 'services', 'core', 'routes.ts'),
    readTemplate('core-routes.ts'),
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
  fs.writeFileSync(sstConfigPath, readTemplate('sst.config.ts').replace('{{PROJECT_NAME}}', projectName));

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
      fs.writeFileSync(pagePath, readTemplate('example-page.tsx'));
      console.log(`Created example page at ${path.relative(projectRoot, pagePath)}`);
    } catch (error) {
      console.warn('Warning: Could not create example page:', error);
    }
  } else {
    console.warn('Warning: Could not find apps/web/src/app or apps/web/app directory');
  }

  // Step 15: Create global components, lib/utils, UI components, and globals.css
  const webRoot = fs.existsSync(webSrcAppDir)
    ? path.join(projectRoot, 'apps', 'web', 'src')
    : fs.existsSync(webAppDir)
      ? path.join(projectRoot, 'apps', 'web')
      : null;

  if (webRoot) {
    const appDir = fs.existsSync(webSrcAppDir) ? webSrcAppDir : webAppDir;

    // Create directories
    fs.mkdirSync(path.join(webRoot, 'components', 'ui'), { recursive: true });
    fs.mkdirSync(path.join(webRoot, 'lib'), { recursive: true });

    // Global components
    console.log('🌐 Creating global components...');
    fs.writeFileSync(
      path.join(webRoot, 'components', 'global-initializer.tsx'),
      readTemplate('global-initializer.tsx'),
    );
    fs.writeFileSync(
      path.join(webRoot, 'components', 'global-loader.tsx'),
      readTemplate('global-loader.tsx'),
    );

    // lib/utils.ts
    console.log('🔧 Creating lib/utils.ts...');
    fs.writeFileSync(
      path.join(webRoot, 'lib', 'utils.ts'),
      readTemplate('lib-utils.ts'),
    );

    // Shadcn UI components
    console.log('🎨 Creating shadcn UI components...');
    fs.writeFileSync(
      path.join(webRoot, 'components', 'ui', 'button.tsx'),
      readTemplate('ui-button.tsx'),
    );
    fs.writeFileSync(
      path.join(webRoot, 'components', 'ui', 'card.tsx'),
      readTemplate('ui-card.tsx'),
    );
    fs.writeFileSync(
      path.join(webRoot, 'components', 'ui', 'input.tsx'),
      readTemplate('ui-input.tsx'),
    );
    fs.writeFileSync(
      path.join(webRoot, 'components', 'ui', 'label.tsx'),
      readTemplate('ui-label.tsx'),
    );

    // Replace globals.css with shadcn theme
    console.log('🎨 Setting up shadcn globals.css...');
    const globalsCssPath = path.join(appDir, 'globals.css');
    fs.writeFileSync(globalsCssPath, readTemplate('globals.css'));

    // Update layout.tsx with GlobalInitializer, GlobalLoader, and loader-portal
    console.log('📐 Updating layout.tsx with global components...');
    const layoutPath = path.join(appDir, 'layout.tsx');
    if (fs.existsSync(layoutPath)) {
      try {
        let layoutContent = fs.readFileSync(layoutPath, 'utf8');

        // Add imports after existing imports
        const globalImports = `import GlobalInitializer from '#/components/global-initializer';\nimport GlobalLoader from '#/components/global-loader';`;
        // Insert after the last import statement
        const lastImportIndex = layoutContent.lastIndexOf('import ');
        const lineEnd = layoutContent.indexOf('\n', lastImportIndex);
        layoutContent =
          layoutContent.slice(0, lineEnd + 1) +
          globalImports +
          '\n' +
          layoutContent.slice(lineEnd + 1);

        // Add loader-portal div and global components inside <body>
        layoutContent = layoutContent.replace(
          /(<body[^>]*>)/,
          `$1\n        <div id="loader-portal" />\n        <GlobalInitializer />\n        <GlobalLoader />`,
        );

        fs.writeFileSync(layoutPath, layoutContent);
      } catch (error) {
        console.warn('Warning: Could not update layout.tsx:', error);
      }
    }

    // Replace postcss.config.mjs with @tailwindcss/postcss
    const postcssPath = path.join(projectRoot, 'apps', 'web', 'postcss.config.mjs');
    if (fs.existsSync(postcssPath)) {
      fs.writeFileSync(
        postcssPath,
        `const config = {\n  plugins: {\n    '@tailwindcss/postcss': {},\n  },\n};\n\nexport default config;\n`,
      );
    }

    // Create API proxy routes
    console.log('🔀 Creating API proxy routes...');
    const apiDir = path.join(appDir, 'api');
    const catchAllDir = path.join(apiDir, '[...proxy]');
    fs.mkdirSync(catchAllDir, { recursive: true });
    fs.writeFileSync(
      path.join(apiDir, 'proxy-request.ts'),
      readTemplate('proxy-request.ts'),
    );
    fs.writeFileSync(
      path.join(catchAllDir, 'route.ts'),
      readTemplate('proxy-route.ts'),
    );
  }

  // Step 16: Update apps/web tsconfig.json with monorise path alias
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

      // Add path aliases
      webTsconfig.compilerOptions.paths['#/shared/*'] = ['../../shared/*'];
      webTsconfig.compilerOptions.paths['#/monorise/*'] = ['../../.monorise/*'];
      const hasSrcDir = fs.existsSync(path.join(projectRoot, 'apps', 'web', 'src'));
      webTsconfig.compilerOptions.paths['#/*'] = [hasSrcDir ? './src/*' : './*'];

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
