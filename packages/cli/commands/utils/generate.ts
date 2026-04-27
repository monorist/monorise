import fs from 'node:fs';
import path from 'node:path';
import { detectCombinedPackage } from './detect-package';

function kebabToCamel(str: string): string {
  return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function kebabToPascal(kebab: string): string {
  return kebab
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

function generateMutualDataMappingDeclarations(
  mutualPairs: {
    byEnumKey: string;
    entityEnumKey: string;
    variableName: string;
    fieldKey: string;
  }[],
): string {
  if (mutualPairs.length === 0) return '';

  // Group by byEnumKey → { entityEnumKey: schemaPath }
  const grouped = new Map<string, string[]>();
  for (const pair of mutualPairs) {
    const schemaPath = `z.infer<(typeof ${pair.variableName})['mutual']['mutualFields']['${pair.fieldKey}']['mutual']['mutualDataSchema']>`;
    const entry = `[Entity.${pair.entityEnumKey}]: ${schemaPath};`;
    if (!grouped.has(pair.byEnumKey)) {
      grouped.set(pair.byEnumKey, []);
    }
    grouped.get(pair.byEnumKey)!.push(entry);
  }

  const mappingEntries = Array.from(grouped.entries())
    .map(
      ([enumKey, entries]) =>
        `    [Entity.${enumKey}]: {\n      ${entries.join('\n      ')}\n    };`,
    )
    .join('\n');

  const block = `
  export interface MutualDataMapping {
${mappingEntries}
  }`;

  return `
declare module '@monorise/react' {
${block}
}

declare module 'monorise/react' {
${block}
}
`;
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

  // Track mutual pairs for MutualDataMapping codegen and duplicate detection
  // Each entry: { byEnumKey, entityEnumKey, variableName, fieldKey, mutualRef }
  const mutualPairs: {
    byEnumKey: string;
    entityEnumKey: string;
    variableName: string;
    fieldKey: string;
    mutualRef: any;
    file: string;
  }[] = [];
  // Map of normalized pair key → first seen mutualRef for duplicate detection
  const seenMutualPairs = new Map<string, { mutualRef: any; file: string; fieldKey: string }>();

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

    // Collect mutual pairs for codegen and duplicate detection
    if (config.mutual?.mutualFields) {
      for (const [fieldKey, fieldConfig] of Object.entries(config.mutual.mutualFields) as [string, any][]) {
        if (fieldConfig.mutual?.mutualDataSchema) {
          const targetName = fieldConfig.entityType as string;
          const entityEnumKey = targetName.toUpperCase().replace(/-/g, '_');

          // Duplicate detection: normalize pair alphabetically
          const pairKey = [config.name, targetName].sort().join('::');
          const existing = seenMutualPairs.get(pairKey);
          if (existing && existing.mutualRef !== fieldConfig.mutual) {
            throw new Error(
              `Conflicting mutual configs for entity pair [${config.name}, ${targetName}]: ` +
              `found in ${file} (field: ${fieldKey}) and ${existing.file} (field: ${existing.fieldKey}). ` +
              `Use the same createMutualConfig instance for both sides.`,
            );
          }
          seenMutualPairs.set(pairKey, { mutualRef: fieldConfig.mutual, file, fieldKey });

          mutualPairs.push({
            byEnumKey: enumKey,
            entityEnumKey,
            variableName,
            fieldKey,
            mutualRef: fieldConfig.mutual,
            file,
          });
        }
      }
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

declare module '@monorise/base' {
  export enum Entity {
    ${enumEntries.join(',\n    ')}
  }

  ${typeEntries.join('\n  ')}

  export interface EntitySchemaMap {
    ${schemaMapEntries.join('\n    ')}
  }
}

declare module 'monorise/base' {
  export enum Entity {
    ${enumEntries.join(',\n    ')}
  }

  ${typeEntries.join('\n  ')}

  export interface EntitySchemaMap {
    ${schemaMapEntries.join('\n    ')}
  }
}
${generateMutualDataMappingDeclarations(mutualPairs)}
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

  const usesCombinedPackage = detectCombinedPackage(projectRoot);
  const coreImportPath = usesCombinedPackage ? 'monorise/core' : '@monorise/core';

  const combinedContent = `
import { AppHandler, CoreFactory } from '${coreImportPath}';
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

  const configDir = path.resolve(monoriseConfig.configDir);
  const monoriseOutputDir = path.join(projectRoot, '.monorise');

  fs.mkdirSync(monoriseOutputDir, { recursive: true });

  await generateConfigFile(configDir, monoriseOutputDir);
  await generateHandleFile(monoriseConfig, projectRoot, monoriseOutputDir);

  return configDir;
}

export default generateFiles;
