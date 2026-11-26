import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { type DevtoolEntity, entityMetadata } from './devtool/metadata';
import {
  DEFAULT_DEVTOOL_PORT,
  type DevtoolConnections,
  createDevtoolServer,
} from './devtool/server';
import {
  type DevtoolApiKey,
  type ResolvedDevtoolStage,
  discoverSstStages,
  resolveSstStage,
} from './devtool/sst';

type MonoriseProjectConfig = {
  configDir: string;
  devtool?: {
    apiUrl?: string;
    port?: number;
  };
};

export type DevtoolOptions = {
  rootPath?: string;
  apiUrl?: string;
  apiKey?: string;
  stage?: string;
  port?: number;
  open?: boolean;
};

async function importModule(filePath: string) {
  return import(pathToFileURL(filePath).href);
}

async function loadProject(rootPath?: string): Promise<{
  root: string;
  config: MonoriseProjectConfig;
  entities: DevtoolEntity[];
}> {
  const root = path.resolve(rootPath ?? process.cwd());
  const configPath = ['monorise.config.ts', 'monorise.config.js']
    .map((name) => path.join(root, name))
    .find((candidate) => fs.existsSync(candidate));

  if (!configPath) {
    throw new Error(
      'Run this command from a Monorise project root (monorise.config.ts or monorise.config.js was not found).',
    );
  }

  const configModule = await importModule(configPath);
  const config = configModule.default as MonoriseProjectConfig;
  if (!config?.configDir) {
    throw new Error(`${path.basename(configPath)} must define configDir.`);
  }

  const configDir = path.resolve(root, config.configDir);
  if (!fs.existsSync(configDir) || !fs.statSync(configDir).isDirectory()) {
    throw new Error(`Entity config directory was not found: ${configDir}`);
  }

  const configFiles = fs
    .readdirSync(configDir)
    .filter(
      (file) =>
        /\.(?:[cm]?[jt]s)$/.test(file) &&
        !file.endsWith('.d.ts') &&
        !/^index\./.test(file),
    )
    .sort();
  const entities: DevtoolEntity[] = [];

  for (const file of configFiles) {
    const module = await importModule(path.join(configDir, file));
    if (!module.default?.name) {
      throw new Error(
        `${path.relative(root, path.join(configDir, file))} must default export an entity config.`,
      );
    }
    entities.push(entityMetadata(module.default));
  }

  entities.sort((left, right) =>
    left.displayName.localeCompare(right.displayName),
  );
  return { root, config, entities };
}

function openBrowser(url: string) {
  const command =
    process.platform === 'darwin'
      ? { executable: 'open', args: [url] }
      : process.platform === 'win32'
        ? { executable: 'cmd', args: ['/c', 'start', '', url] }
        : { executable: 'xdg-open', args: [url] };
  const child = spawn(command.executable, command.args, {
    detached: true,
    stdio: 'ignore',
  });
  child.on('error', () => {
    console.warn(
      `Could not open a browser automatically. Open ${url} instead.`,
    );
  });
  child.unref();
}

export async function runDevtoolCommand(options: DevtoolOptions = {}) {
  const { root, config, entities } = await loadProject(options.rootPath);
  if (entities.length === 0) {
    throw new Error('No entity config files were found.');
  }

  const configuredApiUrl =
    options.apiUrl ??
    process.env.MONORISE_API_URL ??
    process.env.API_BASE_URL ??
    config.devtool?.apiUrl;
  const apiUrl = configuredApiUrl ?? 'http://localhost:3000/api';
  const apiKey =
    options.apiKey ?? process.env.MONORISE_API_KEY ?? process.env.X_API_KEY;
  const port = options.port ?? config.devtool?.port ?? DEFAULT_DEVTOOL_PORT;

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid devtool port: ${port}`);
  }
  let parsedApiUrl: URL;
  try {
    parsedApiUrl = new URL(apiUrl);
  } catch {
    throw new Error(`Invalid Monorise API URL: ${apiUrl}`);
  }
  if (!['http:', 'https:'].includes(parsedApiUrl.protocol)) {
    throw new Error('The Monorise API URL must use http or https.');
  }

  const manualKey: DevtoolApiKey | undefined = apiKey
    ? {
        id: 'manual',
        label: 'Manual key',
        value: apiKey,
      }
    : undefined;
  const localStage = {
    id: 'local',
    label: configuredApiUrl ? 'Configured URL' : 'Local app proxy',
    source: 'local' as const,
  };
  const localConnection: ResolvedDevtoolStage = {
    apiUrl: parsedApiUrl.toString(),
    keys: manualKey ? [manualKey] : [],
  };

  let deployedStages: string[] = [];
  try {
    deployedStages = await discoverSstStages(root);
  } catch (error) {
    console.warn(
      `Could not discover deployed SST stages: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const stageSummaries = [
    localStage,
    ...deployedStages.map((stage) => ({
      id: `sst:${stage}`,
      label: stage,
      source: 'sst' as const,
    })),
  ];
  const resolveStage = async (stageId: string) => {
    if (stageId === localStage.id) return localConnection;
    const stage = stageSummaries.find(({ id }) => id === stageId);
    if (!stage || stage.source !== 'sst') {
      throw new Error(`Unknown SST stage: ${stageId}`);
    }
    const resolved = await resolveSstStage(root, stage.label);
    if (
      manualKey &&
      !resolved.keys.some(({ value }) => value === manualKey.value)
    ) {
      resolved.keys.unshift(manualKey);
    }
    return resolved;
  };
  const requestedStageId = options.stage ? `sst:${options.stage}` : 'local';
  const initialStage =
    stageSummaries.find(({ id }) => id === requestedStageId) ?? localStage;
  if (options.stage && initialStage === localStage) {
    throw new Error(
      `SST stage '${options.stage}' was not found for the current credentials.`,
    );
  }
  const initialConnection =
    initialStage.id === 'local'
      ? localConnection
      : await resolveStage(initialStage.id);
  const connections: DevtoolConnections = {
    stages: stageSummaries,
    initialStage,
    initialConnection,
    resolve: resolveStage,
  };

  const devtool = createDevtoolServer({
    entities,
    connections,
    port,
  });
  const address = await devtool.listen();

  console.log('');
  console.log(`Monorise Devtool is ready at ${address.url}`);
  console.log(
    `Connection: ${initialStage.label} (${initialConnection.apiUrl.replace(/\/$/, '')})`,
  );
  if (deployedStages.length) {
    console.log(`SST stages: ${deployedStages.join(', ')}`);
  }
  console.log(`Entities: ${entities.map(({ name }) => name).join(', ')}`);
  console.log('Press Ctrl+C to stop.');
  console.log('');

  if (options.open !== false) openBrowser(address.url);

  const close = async () => {
    await devtool.close();
    process.exit(0);
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);

  return { ...address, close: devtool.close };
}

export { loadProject };
