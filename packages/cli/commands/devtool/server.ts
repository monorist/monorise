import { createHash } from 'node:crypto';
import {
  type IncomingMessage,
  type ServerResponse,
  createServer,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import type { DevtoolEntity } from './metadata';
import type {
  DevtoolApiKey,
  DevtoolStageSummary,
  ResolvedDevtoolStage,
} from './sst';
import { APP_JS, INDEX_HTML, STYLES_CSS } from './ui';

export const DEFAULT_DEVTOOL_PORT = 6767;

export type DevtoolConnections = {
  stages: DevtoolStageSummary[];
  initialStage: DevtoolStageSummary;
  initialConnection: ResolvedDevtoolStage;
  resolve: (stageId: string) => Promise<ResolvedDevtoolStage>;
};

export type DevtoolServerOptions = {
  apiUrl?: string;
  apiKey?: string;
  entities: DevtoolEntity[];
  connections?: DevtoolConnections;
  host?: string;
  port?: number;
};

const MAX_BODY_BYTES = 1024 * 1024;
const MANUAL_STAGE: DevtoolStageSummary = {
  id: 'manual',
  label: 'Manual connection',
  source: 'local',
};

function resolveManualConnection(payload: {
  apiUrl?: unknown;
  apiKey?: unknown;
}): ResolvedDevtoolStage {
  if (typeof payload.apiUrl !== 'string' || !payload.apiUrl.trim()) {
    throw new Error('Core API URL is required');
  }
  if (payload.apiKey !== undefined && typeof payload.apiKey !== 'string') {
    throw new Error('API key must be a string');
  }

  let apiUrl: URL;
  try {
    apiUrl = new URL(payload.apiUrl.trim());
  } catch {
    throw new Error('Enter a valid Core API URL');
  }
  if (!['http:', 'https:'].includes(apiUrl.protocol)) {
    throw new Error('The Core API URL must use http or https');
  }
  if (apiUrl.username || apiUrl.password) {
    throw new Error('The Core API URL cannot contain credentials');
  }
  if (apiUrl.search || apiUrl.hash) {
    throw new Error('The Core API URL cannot contain a query or fragment');
  }

  const value = payload.apiKey ?? '';
  const fingerprint = value
    ? createHash('sha256').update(value).digest('hex')
    : '';
  const keys: DevtoolApiKey[] = value
    ? [
        {
          id: `manual:${fingerprint}`,
          label: `Manual · ${fingerprint.slice(0, 8)}`,
          value,
        },
      ]
    : [];
  return {
    apiUrl: apiUrl.toString().replace(/\/+$/, ''),
    keys,
  };
}

function send(
  response: ServerResponse,
  status: number,
  body: string,
  contentType: string,
) {
  response.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
  send(
    response,
    status,
    JSON.stringify(value),
    'application/json; charset=utf-8',
  );
}

async function requestBody(
  request: IncomingMessage,
): Promise<Buffer | undefined> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  let length = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > MAX_BODY_BYTES) {
      throw new Error('REQUEST_TOO_LARGE');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function entityRoute(pathname: string) {
  const match = pathname.match(/^\/api\/entities\/([^/]+)(?:\/([^/]+))?$/);
  if (!match) return undefined;
  try {
    return {
      entityType: decodeURIComponent(match[1]),
      entityId: match[2] ? decodeURIComponent(match[2]) : undefined,
    };
  } catch {
    return undefined;
  }
}

function tagRoute(pathname: string) {
  const match = pathname.match(/^\/api\/tags\/([^/]+)\/([^/]+)$/);
  if (!match) return undefined;
  try {
    return {
      entityType: decodeURIComponent(match[1]),
      tagName: decodeURIComponent(match[2]),
    };
  } catch {
    return undefined;
  }
}

function mutualRoute(pathname: string) {
  const match = pathname.match(
    /^\/api\/mutuals\/([^/]+)\/([^/]+)\/([^/]+)(?:\/([^/]+))?$/,
  );
  if (!match) return undefined;
  try {
    return {
      byEntityType: decodeURIComponent(match[1]),
      byEntityId: decodeURIComponent(match[2]),
      entityType: decodeURIComponent(match[3]),
      entityId: match[4] ? decodeURIComponent(match[4]) : undefined,
    };
  } catch {
    return undefined;
  }
}

export function createDevtoolServer(options: DevtoolServerOptions) {
  const host = options.host ?? '127.0.0.1';
  const configuredPort = options.port ?? DEFAULT_DEVTOOL_PORT;
  const allowedEntities = new Set(options.entities.map(({ name }) => name));
  const allowedTags = new Map(
    options.entities.map(({ name, tags }) => [name, new Set(tags ?? [])]),
  );
  const staticStage: DevtoolStageSummary = {
    id: 'local',
    label: 'Local',
    source: 'local',
  };
  const staticKey: DevtoolApiKey | undefined = options.apiKey
    ? {
        id: 'manual',
        label: 'Manual key',
        value: options.apiKey,
      }
    : undefined;
  const connections: DevtoolConnections = options.connections ?? {
    stages: [staticStage],
    initialStage: staticStage,
    initialConnection: {
      apiUrl: options.apiUrl ?? 'http://localhost:3000/api',
      keys: staticKey ? [staticKey] : [],
    },
    resolve: async () => ({
      apiUrl: options.apiUrl ?? 'http://localhost:3000/api',
      keys: staticKey ? [staticKey] : [],
    }),
  };
  let active = {
    stage: connections.initialStage,
    connection: connections.initialConnection,
    keyId: connections.initialConnection.keys[0]?.id,
  };

  const publicConnection = () => ({
    stageId: active.stage.id,
    apiUrl: active.connection.apiUrl.replace(/\/+$/, ''),
    keyId: active.keyId,
    keys: active.connection.keys.map(({ id, label, policy }) => ({
      id,
      label,
      policy,
    })),
    warning: active.connection.warning,
  });

  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? '/', `http://${host}`);

    if (request.method === 'GET' && requestUrl.pathname === '/') {
      response.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      );
      return send(response, 200, INDEX_HTML, 'text/html; charset=utf-8');
    }
    if (request.method === 'GET' && requestUrl.pathname === '/styles.css') {
      return send(response, 200, STYLES_CSS, 'text/css; charset=utf-8');
    }
    if (request.method === 'GET' && requestUrl.pathname === '/app.js') {
      return send(response, 200, APP_JS, 'text/javascript; charset=utf-8');
    }
    if (request.method === 'GET' && requestUrl.pathname === '/favicon.ico') {
      response.writeHead(204);
      return response.end();
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/meta') {
      return sendJson(response, 200, {
        apiUrl: publicConnection().apiUrl,
        entities: options.entities,
        stages: connections.stages,
        connection: publicConnection(),
      });
    }
    if (
      request.method === 'POST' &&
      requestUrl.pathname === '/api/connection'
    ) {
      try {
        const body = await requestBody(request);
        const payload = JSON.parse(body?.toString('utf8') || '{}') as {
          stageId?: string;
        };
        const stage = connections.stages.find(
          ({ id }) => id === payload.stageId,
        );
        if (!stage) {
          return sendJson(response, 400, { message: 'Unknown stage' });
        }
        const connection = await connections.resolve(stage.id);
        active = {
          stage,
          connection,
          keyId: connection.keys[0]?.id,
        };
        return sendJson(response, 200, publicConnection());
      } catch (error) {
        if ((error as Error).message === 'REQUEST_TOO_LARGE') {
          return sendJson(response, 413, {
            message: 'Request body exceeds the 1 MB limit',
          });
        }
        return sendJson(response, 502, {
          message:
            error instanceof Error
              ? error.message
              : 'Could not connect to this stage',
        });
      }
    }
    if (
      request.method === 'POST' &&
      requestUrl.pathname === '/api/connection/key'
    ) {
      try {
        const body = await requestBody(request);
        const payload = JSON.parse(body?.toString('utf8') || '{}') as {
          keyId?: string;
        };
        if (
          payload.keyId !== undefined &&
          !active.connection.keys.some(({ id }) => id === payload.keyId)
        ) {
          return sendJson(response, 400, { message: 'Unknown API key' });
        }
        active.keyId = payload.keyId;
        return sendJson(response, 200, publicConnection());
      } catch {
        return sendJson(response, 400, { message: 'Invalid request body' });
      }
    }
    if (
      request.method === 'POST' &&
      requestUrl.pathname === '/api/connection/manual'
    ) {
      try {
        const body = await requestBody(request);
        const payload = JSON.parse(body?.toString('utf8') || '{}') as {
          apiUrl?: unknown;
          apiKey?: unknown;
        };
        const connection = resolveManualConnection(payload);
        active = {
          stage: MANUAL_STAGE,
          connection,
          keyId: connection.keys[0]?.id,
        };
        return sendJson(response, 200, publicConnection());
      } catch (error) {
        if ((error as Error).message === 'REQUEST_TOO_LARGE') {
          return sendJson(response, 413, {
            message: 'Request body exceeds the 1 MB limit',
          });
        }
        return sendJson(response, 400, {
          message:
            error instanceof Error
              ? error.message
              : 'Invalid manual connection',
        });
      }
    }

    const entity = entityRoute(requestUrl.pathname);
    const tag = tagRoute(requestUrl.pathname);
    const mutual = mutualRoute(requestUrl.pathname);
    if (!entity && !tag && !mutual) {
      return sendJson(response, 404, { message: 'Not found' });
    }
    let requestedTypes: string[];
    if (entity) requestedTypes = [entity.entityType];
    else if (tag) requestedTypes = [tag.entityType];
    else if (mutual) {
      requestedTypes = [mutual.byEntityType, mutual.entityType];
    } else {
      return sendJson(response, 404, { message: 'Not found' });
    }
    if (requestedTypes.some((entityType) => !allowedEntities.has(entityType))) {
      return sendJson(response, 404, { message: 'Unknown entity type' });
    }
    if (tag && !allowedTags.get(tag.entityType)?.has(tag.tagName)) {
      return sendJson(response, 404, { message: 'Unknown tag' });
    }

    const allowedMethods =
      entity || mutual ? ['GET', 'POST', 'PATCH', 'DELETE'] : ['GET'];
    if (!allowedMethods.includes(request.method ?? '')) {
      response.setHeader('Allow', allowedMethods.join(', '));
      return sendJson(response, 405, { message: 'Method not allowed' });
    }
    if (
      entity &&
      (request.method === 'PATCH' || request.method === 'DELETE') &&
      !entity.entityId
    ) {
      return sendJson(response, 400, { message: 'Entity ID is required' });
    }
    if (entity && request.method === 'POST' && entity.entityId) {
      return sendJson(response, 405, { message: 'Method not allowed' });
    }
    if (
      mutual &&
      ['POST', 'PATCH', 'DELETE'].includes(request.method ?? '') &&
      !mutual.entityId
    ) {
      return sendJson(response, 400, {
        message: 'Related entity ID is required',
      });
    }

    try {
      const body = await requestBody(request);
      const apiUrl = active.connection.apiUrl.replace(/\/+$/, '');
      let upstreamPath: string;
      if (entity) {
        upstreamPath = `/core/entity/${encodeURIComponent(entity.entityType)}${
          entity.entityId ? `/${encodeURIComponent(entity.entityId)}` : ''
        }`;
      } else if (tag) {
        upstreamPath = `/core/tag/${encodeURIComponent(tag.entityType)}/${encodeURIComponent(tag.tagName)}`;
      } else if (mutual) {
        upstreamPath = `/core/mutual/${encodeURIComponent(mutual.byEntityType)}/${encodeURIComponent(mutual.byEntityId)}/${encodeURIComponent(mutual.entityType)}${
          mutual.entityId ? `/${encodeURIComponent(mutual.entityId)}` : ''
        }`;
      } else {
        return sendJson(response, 404, { message: 'Not found' });
      }
      const upstream = new URL(`${apiUrl}${upstreamPath}`);
      upstream.search = requestUrl.search;

      const headers = new Headers({ Accept: 'application/json' });
      if (body?.length) headers.set('Content-Type', 'application/json');
      const apiKey = active.connection.keys.find(
        ({ id }) => id === active.keyId,
      )?.value;
      if (apiKey) headers.set('x-api-key', apiKey);

      const upstreamResponse = await fetch(upstream, {
        method: request.method,
        headers,
        body,
        redirect: 'manual',
      });
      const responseBody = Buffer.from(await upstreamResponse.arrayBuffer());
      response.writeHead(upstreamResponse.status, {
        'Content-Type':
          upstreamResponse.headers.get('content-type') ??
          'application/json; charset=utf-8',
        'Content-Length': responseBody.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(responseBody);
    } catch (error) {
      if ((error as Error).message === 'REQUEST_TOO_LARGE') {
        return sendJson(response, 413, {
          message: 'Request body exceeds the 1 MB limit',
        });
      }
      console.error('[monorise devtool] API proxy failed:', error);
      return sendJson(response, 502, {
        message: `Could not reach the Monorise API at ${active.connection.apiUrl.replace(/\/+$/, '')}`,
      });
    }
  });

  return {
    server,
    listen: () =>
      new Promise<{ host: string; port: number; url: string }>(
        (resolve, reject) => {
          server.once('error', reject);
          server.listen(configuredPort, host, () => {
            server.off('error', reject);
            const address = server.address() as AddressInfo;
            resolve({
              host,
              port: address.port,
              url: `http://${host}:${address.port}`,
            });
          });
        },
      ),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
