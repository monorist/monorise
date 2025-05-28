#!/usr/bin/env node

import 'tsx';
import 'tsconfig-paths/register.js';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
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

async function generateConfig(): Promise<string> {
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

  // Dynamically import the config file
  const monoriseConfig = await import(configFilePath);
  const configDir = path.resolve(monoriseConfig.default.configDir);

  const configOutputPath = path.join(configDir, 'index.ts');
  const initialOutputContent = `
export enum Entity {}
`;

  // Clean up and initialize index.ts file, so that tsconfig resolves import correctly
  fs.writeFileSync(configOutputPath, initialOutputContent);

  const files = fs
    .readdirSync(configDir)
    .filter((file) => file.endsWith('.ts') && file !== 'index.ts');

  const names = new Set<string>();
  const nameRegex = /^[a-z]+(-[a-z]+)*$/;
  const imports: string[] = [];
  const importTypes: string[] = [];
  const arrayElements: string[] = [];

  const enumEntries: string[] = [];
  const typeEntries: string[] = [];
  const schemaMapEntries: string[] = [];
  const configEntries: string[] = [];
  const schemaEntries: string[] = [];
  const allowedEntityEntries: string[] = [];
  const entityWithEmailAuthEntries: string[] = [];

  for (const file of files) {
    const fullPath = path.join(configDir, file);
    const module = await import(fullPath);
    const config = module.default;

    // Validate name
    if (!nameRegex.test(config.name)) {
      throw new Error(
        `Invalid name format: ${config.name} in ${file}. Must be kebab-case.`,
      );
    }

    if (names.has(config.name)) {
      throw new Error(`Duplicate name found: ${config.name} in ${file}`);
    }
    names.add(config.name);

    // Generate import and array element
    const fileName = file.replace(/\.ts$/, '');
    const variableName = kebabToCamel(fileName);
    imports.push(`import ${variableName} from './${fileName}';`);
    importTypes.push(`import type ${variableName} from './${fileName}';`);
    arrayElements.push(variableName);

    // Generate enum entry
    const enumKey = config.name.toUpperCase().replace(/-/g, '_');
    enumEntries.push(`${enumKey} = '${config.name}'`);
    typeEntries.push(
      `export type ${kebabToPascal(config.name)}Type = z.infer<(typeof ${variableName})['finalSchema']>;`,
    );
    schemaMapEntries.push(
      `[Entity.${enumKey}]: ${kebabToPascal(config.name)}Type;`,
    );

    // Generate config entry
    configEntries.push(`[Entity.${enumKey}]: ${kebabToCamel(config.name)},`);
    schemaEntries.push(
      `[Entity.${enumKey}]: ${kebabToCamel(config.name)}.finalSchema,`,
    );

    allowedEntityEntries.push(`Entity.${enumKey}`);

    if (config.authMethod?.email) {
      entityWithEmailAuthEntries.push(`Entity.${enumKey}`);
    }
  }

  const outputContent = `
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

  fs.writeFileSync(configOutputPath, outputContent);
  console.log('Successfully generated entity configurations and enum!');
  return configDir;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'dev') {
    let configDir: string | undefined;
    try {
      configDir = await generateConfig();
    } catch (err) {
      console.error('Generation failed:', err);
      process.exit(1);
    }

    if (configDir) {
      console.log(`Watching for changes in ${configDir}...`);
      const watcher = chokidar.watch(configDir, {
        ignored: (watchedPath: string) => {
          const fileName = path.basename(watchedPath);
          return (
            fileName === 'index.ts' ||
            fileName.startsWith('.') ||
            watchedPath.endsWith('.js') ||
            watchedPath.endsWith('.jsx') ||
            watchedPath.endsWith('.d.ts')
          );
        },
        persistent: true,
        ignoreInitial: true,
      });

      let sstDevProcess: ReturnType<typeof spawn> | null = null;

      const runSSTDev = () => {
        if (sstDevProcess) {
          console.log('Terminating existing sst dev process...');
          sstDevProcess.kill('SIGTERM');
          sstDevProcess = null;
        }
        console.log('Starting sst dev...');
        sstDevProcess = spawn('npx', ['sst', 'dev'], { stdio: 'inherit' });
        sstDevProcess.on('close', (code) => {
          console.log(`sst dev process exited with code ${code}`);
          sstDevProcess = null;
        });
        sstDevProcess.on('error', (err) => {
          console.error('Failed to start sst dev process:', err);
          sstDevProcess = null;
        });
      };

      watcher.on('add', async (filePath) => {
        console.log(`File ${filePath} has been added. Regenerating...`);
        try {
          await generateConfig();
        } catch (err) {
          console.error('Regeneration failed:', err);
        }
      });

      watcher.on('change', async (filePath) => {
        console.log(`File ${filePath} has been changed. Regenerating...`);
        try {
          await generateConfig();
        } catch (err) {
          console.error('Regeneration failed:', err);
        }
      });

      watcher.on('unlink', async (filePath) => {
        console.log(`File ${filePath} has been removed. Regenerating...`);
        try {
          await generateConfig();
        } catch (err) {
          console.error('Regeneration failed:', err);
        }
      });

      // sst dev is started only once, after initial generation
      runSSTDev();

      process.on('SIGINT', () => {
        console.log('Monorise dev terminated. Closing watcher and sst dev...');
        watcher.close();
        if (sstDevProcess) {
          sstDevProcess.kill('SIGTERM');
        }
        process.exit(0);
      });
      process.on('SIGTERM', () => {
        console.log('Monorise dev terminated. Closing watcher and sst dev...');
        watcher.close();
        if (sstDevProcess) {
          sstDevProcess.kill('SIGTERM');
        }
        process.exit(0);
      });
    }
  } else if (command === 'build') {
    try {
      await generateConfig();
    } catch (err) {
      console.error('Build generation failed:', err);
      process.exit(1);
    }
  } else {
    console.error('Unknown command. Usage: monorise [dev|build]');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Monorise encountered an unhandled error:', err);
  process.exit(1);
});
