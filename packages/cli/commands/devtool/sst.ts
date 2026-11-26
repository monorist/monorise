import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type DevtoolApiKey = {
  id: string;
  label: string;
  policy?: string;
  value: string;
};

export type ResolvedDevtoolStage = {
  apiUrl: string;
  keys: DevtoolApiKey[];
  warning?: string;
};

export type DevtoolStageSummary = {
  id: string;
  label: string;
  source: 'local' | 'sst';
};

export type SstRunner = (
  args: string[],
  options: { cwd: string },
) => Promise<string>;

const SHELL_MARKER = '__MONORISE_DEVTOOL__';
const ANSI_ESCAPE = new RegExp(
  `${String.fromCharCode(27)}(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~])`,
  'g',
);

const SHELL_DISCOVERY_SCRIPT = `
const resources = [];
try {
  const consolidated = JSON.parse(process.env.SST_RESOURCES_JSON || '{}');
  resources.push(...Object.entries(consolidated));
} catch {}
for (const [name, raw] of Object.entries(process.env)) {
  if (!name.startsWith('SST_RESOURCE_') || !raw) continue;
  try {
    resources.push([name.slice('SST_RESOURCE_'.length), JSON.parse(raw)]);
  } catch {}
}
const markedApis = resources
  .filter(([, value]) =>
    value?.kind === 'monorise-devtool' &&
    typeof value?.apiUrl === 'string'
  )
  .map(([name, value]) => ({
    name: value.coreId || name,
    url: value.apiUrl,
  }));
const legacyApis = resources
  .filter(([name, value]) =>
    /monorise.*api/i.test(name) &&
    typeof value?.url === 'string'
  )
  .map(([name, value]) => ({
    name: name.replace(/-monorise-api$/i, ''),
    url: value.url,
  }));
const apiKeys = resources.find(([name]) => name === 'API_KEYS')?.[1]?.value;
const result = {
  apis: markedApis.length ? markedApis : legacyApis,
  apiKeys,
};
process.stdout.write(
  '\\n${SHELL_MARKER}' +
    Buffer.from(JSON.stringify(result)).toString('base64') +
    '\\n',
);
`;

function findSstExecutable(root: string): string | undefined {
  const binary = process.platform === 'win32' ? 'sst.cmd' : 'sst';
  let current = root;
  while (true) {
    const candidate = path.join(current, 'node_modules', '.bin', binary);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export const runSst: SstRunner = (args, { cwd }) =>
  new Promise((resolve, reject) => {
    const executable = findSstExecutable(cwd);
    if (!executable) {
      reject(new Error('SST is not installed in this project.'));
      return;
    }

    execFile(
      executable,
      args,
      {
        cwd,
        env: {
          ...process.env,
          CI: '1',
          NO_COLOR: '1',
          SST_STAGE: process.env.SST_STAGE ?? 'devtool',
        },
        maxBuffer: 10 * 1024 * 1024,
        timeout: 60_000,
      },
      (error, stdout, stderr) => {
        if (error) {
          const message = stderr.trim().split('\n').filter(Boolean).at(-1);
          reject(
            new Error(
              message
                ? `SST command failed: ${message}`
                : `SST command failed: ${error.message}`,
            ),
          );
          return;
        }
        resolve(stdout);
      },
    );
  });

export function parseStageList(output: string): string[] {
  const lines = output.replace(ANSI_ESCAPE, '').split(/\r?\n/);
  const stages: string[] = [];
  let readingStages = false;

  for (const line of lines) {
    const heading = line.match(/^\s*Stages:\s*(.*)$/);
    if (heading) {
      readingStages = true;
      const first = heading[1].replace(/\s+\(not deployed\)\s*$/, '').trim();
      if (first && !heading[1].includes('(not deployed)')) stages.push(first);
      continue;
    }
    if (!readingStages || !line.trim()) continue;
    if (/^\S[^:]*:/.test(line)) break;
    const stage = line.replace(/\s+\(not deployed\)\s*$/, '').trim();
    if (stage && !line.includes('(not deployed)')) stages.push(stage);
  }

  return [...new Set(stages)];
}

export async function discoverSstStages(
  root: string,
  runner: SstRunner = runSst,
): Promise<string[]> {
  if (
    !fs.existsSync(path.join(root, 'sst.config.ts')) &&
    !fs.existsSync(path.join(root, 'sst.config.js'))
  ) {
    return [];
  }
  return parseStageList(await runner(['state', 'list'], { cwd: root }));
}

function keyId(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function parseApiKeys(raw: unknown): {
  keys: DevtoolApiKey[];
  hashedCount: number;
} {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { keys: [], hashedCount: 0 };
  }

  const parsed: unknown = JSON.parse(raw);
  const entries: [string, unknown][] = Array.isArray(parsed)
    ? [['full', parsed]]
    : parsed && typeof parsed === 'object'
      ? Object.entries(parsed)
      : [];
  const keys: DevtoolApiKey[] = [];
  let hashedCount = 0;

  for (const [policy, policyKeys] of entries) {
    if (!Array.isArray(policyKeys)) continue;
    for (const value of policyKeys) {
      if (typeof value !== 'string' || !value) continue;
      if (value.startsWith('sha256:')) {
        hashedCount += 1;
        continue;
      }
      const id = keyId(value);
      keys.push({
        id,
        label: `${policy} · ${id.slice(0, 8)}`,
        policy,
        value,
      });
    }
  }

  return { keys, hashedCount };
}

export function parseSecretList(
  output: string,
  secretName = 'API_KEYS',
): string | undefined {
  const lines = output.replace(ANSI_ESCAPE, '').split(/\r?\n/);
  let currentName: string | undefined;
  let currentValue: string[] = [];
  let found: string | undefined;

  const commit = () => {
    if (currentName === secretName) {
      found = currentValue.join('\n').trim();
    }
    currentName = undefined;
    currentValue = [];
  };

  for (const line of lines) {
    if (/^\s*#/.test(line)) {
      commit();
      continue;
    }
    const assignment = line.match(/^([A-Z][a-zA-Z0-9_]*)=(.*)$/);
    if (assignment) {
      commit();
      currentName = assignment[1];
      currentValue = [assignment[2]];
      continue;
    }
    if (currentName) currentValue.push(line);
  }
  commit();

  return found;
}

export function parseShellDiscovery(output: string): {
  apiUrl: string;
  apiKeys?: string;
} {
  const markerIndex = output.lastIndexOf(SHELL_MARKER);
  if (markerIndex < 0) {
    throw new Error(
      'SST did not return Monorise resource metadata. Redeploy this stage with the current Monorise version.',
    );
  }
  const encoded = output
    .slice(markerIndex + SHELL_MARKER.length)
    .split(/\r?\n/, 1)[0]
    .trim();
  const decoded: unknown = JSON.parse(
    Buffer.from(encoded, 'base64').toString('utf8'),
  );
  const parsed =
    decoded && typeof decoded === 'object'
      ? (decoded as {
          apis?: unknown;
          apiKeys?: unknown;
        })
      : {};
  const apis = Array.isArray(parsed.apis)
    ? (
        parsed.apis as {
          name?: unknown;
          url?: unknown;
        }[]
      ).filter(
        (api): api is { name: string; url: string } =>
          typeof api?.name === 'string' && typeof api?.url === 'string',
      )
    : [];
  if (apis.length === 0) {
    throw new Error(
      'No Monorise Core API was found in this SST stage. Redeploy it with the current Monorise version.',
    );
  }
  if (apis.length > 1) {
    throw new Error(
      `This stage has multiple Monorise Core APIs (${apis.map(({ name }) => name).join(', ')}). Start the devtool with --api-url to choose one.`,
    );
  }
  let apiUrl: URL;
  try {
    apiUrl = new URL(apis[0].url);
  } catch {
    throw new Error('The discovered Monorise API URL is invalid.');
  }
  if (!['http:', 'https:'].includes(apiUrl.protocol)) {
    throw new Error('The discovered Monorise API URL must use http or https.');
  }
  return {
    apiUrl: apiUrl.toString(),
    apiKeys: typeof parsed.apiKeys === 'string' ? parsed.apiKeys : undefined,
  };
}

export async function resolveSstStage(
  root: string,
  stage: string,
  runner: SstRunner = runSst,
): Promise<ResolvedDevtoolStage> {
  const output = await runner(
    ['shell', '--stage', stage, '--', 'node', '-e', SHELL_DISCOVERY_SCRIPT],
    { cwd: root },
  );
  const discovered = parseShellDiscovery(output);
  try {
    const secrets = await runner(['secret', 'list', '--stage', stage], {
      cwd: root,
    });
    discovered.apiKeys = parseSecretList(secrets) ?? discovered.apiKeys;
  } catch (error) {
    if (!(error instanceof Error) || !/no secrets found/i.test(error.message)) {
      throw error;
    }
  }
  let parsedKeys: ReturnType<typeof parseApiKeys>;
  try {
    parsedKeys = parseApiKeys(discovered.apiKeys);
  } catch {
    throw new Error(
      `The API_KEYS secret in stage '${stage}' is not valid JSON.`,
    );
  }

  const warning =
    parsedKeys.hashedCount > 0
      ? `${parsedKeys.hashedCount} pre-hashed API ${parsedKeys.hashedCount === 1 ? 'key is' : 'keys are'} unavailable because original values cannot be recovered.`
      : parsedKeys.keys.length === 0
        ? 'No usable API keys were found for this stage.'
        : undefined;

  return {
    apiUrl: discovered.apiUrl,
    keys: parsedKeys.keys,
    warning,
  };
}
