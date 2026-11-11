import {
  type ProxyEntityConfig,
  type ProxyOperation,
  parseOperations,
} from './operations';
import {
  type CoreClient,
  type ProxyRules,
  type RouteRules,
  type RuleContext,
  checkOperations,
} from './rules';

/** One kind of caller: the key it calls Core with, and the rules for its users. */
export type ProxyCaller<Session = unknown> = {
  /** A key in `API_KEYS`, usually mapped to a policy for this kind of caller. */
  apiKey: string | undefined;
  rules?: ProxyRules<Session>;
  routes?: RouteRules<Session>;
};

type AuthenticateResult<Session> = Session | null | undefined | Response;

type SharedOptions<Session> = {
  /** The generated config, which says which payload fields are relationships. */
  config: { EntityConfig: ProxyEntityConfig };
  /**
   * Reads the session. `undefined` or `null` is an anonymous visitor; a
   * `Response`, such as a 401 that clears an expired cookie, is sent back as is.
   */
  authenticate?: (
    request: Request,
  ) => AuthenticateResult<Session> | Promise<AuthenticateResult<Session>>;
  /** The prefix stripped before forwarding. Defaults to `/api/core`. */
  basePath?: string;
  /** Core's URL. Defaults to `process.env.API_BASE_URL`. */
  apiBaseUrl?: string;
  /** Logs the rule to add when none matches. Defaults to on outside production. */
  logMissingRules?: boolean;
};

export type ProxyHandlerOptions<Session = unknown> = SharedOptions<Session> &
  (
    | {
        /** Names the kind of caller for this request; `undefined` answers 401. */
        caller: (args: {
          session: Session | undefined;
          request: Request;
        }) => string | undefined | Promise<string | undefined>;
        callers: Record<string, ProxyCaller<Session>>;
        apiKey?: never;
        rules?: never;
        routes?: never;
      }
    | ({ caller?: never; callers?: never } & ProxyCaller<Session>)
  );

export type CheckResult<Session = unknown> =
  | {
      allowed: true;
      /** The kind of caller, or `undefined` for an app with one kind. */
      caller: string | undefined;
      session: Session | undefined;
      operations: ProxyOperation[];
    }
  | { allowed: false; response: Response };

type RequestHandler = (request: Request) => Promise<Response>;

export type ProxyHandler<Session = unknown> = {
  /** Checks a request to Core and forwards it, or answers with the refusal. */
  handle: RequestHandler;
  /** Runs every step but forwarding, so rules can be unit-tested. */
  checkRequest: (request: Request) => Promise<CheckResult<Session>>;
  GET: RequestHandler;
  POST: RequestHandler;
  PUT: RequestHandler;
  PATCH: RequestHandler;
  DELETE: RequestHandler;
};

const FORWARDED_HEADERS = [
  'content-type',
  'accept',
  'accept-language',
  'x-request-id',
];

// fetch has already decoded the body and framed it for this hop.
const DROPPED_RESPONSE_HEADERS = [
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
];

const hasOwn = (object: object, key: string) =>
  Object.prototype.hasOwnProperty.call(object, key);

const env = (name: string) =>
  typeof process === 'undefined' ? undefined : process.env?.[name];

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const unauthorized = () =>
  json(401, { code: 'UNAUTHORIZED', message: 'Unauthorized' });

const misconfigured = (message: string) => {
  console.error(`[monorise/proxy] ${message}`);
  return json(500, { code: 'PROXY_MISCONFIGURED', message });
};

type Prepared<Session> = {
  caller: string | undefined;
  session: Session | undefined;
  apiKey: string;
  apiBaseUrl: string;
  /** The path under `/core`, as the client encoded it, with its query. */
  target: string;
  body: ArrayBuffer | undefined;
  operations: ProxyOperation[];
};

/**
 * Puts Monorise Core behind your app's own route. Each request is checked
 * against the rules for its kind of caller, then forwarded with that
 * caller's key: the key decides what the caller can reach, and the rules
 * decide whose records.
 *
 * @example
 * ```ts
 * const proxy = createProxyHandler({
 *   config,
 *   authenticate: (request) => readSession(request),
 *   caller: ({ session }) => session?.type ?? 'public',
 *   callers: {
 *     hirer: { apiKey: process.env.HIRER_API_KEY, rules: hirerRules },
 *     public: { apiKey: process.env.PUBLIC_API_KEY, rules: publicRules },
 *   },
 * });
 *
 * export const { GET, POST, PUT, PATCH, DELETE } = proxy;
 * ```
 */
export const createProxyHandler = <Session = unknown>(
  options: ProxyHandlerOptions<Session>,
): ProxyHandler<Session> => {
  const multiple =
    options.callers !== undefined || options.caller !== undefined;
  if (
    multiple &&
    (typeof options.caller !== 'function' ||
      typeof options.callers !== 'object' ||
      options.apiKey !== undefined ||
      options.rules !== undefined ||
      options.routes !== undefined)
  ) {
    throw new Error(
      'createProxyHandler takes either caller and callers, or apiKey and rules',
    );
  }

  const basePath = `/${(options.basePath ?? '/api/core').replace(/^\/+|\/+$/g, '')}`;
  const entityConfig = options.config?.EntityConfig;
  const logMissingRules =
    options.logMissingRules ?? env('NODE_ENV') !== 'production';

  const coreClient = (apiBaseUrl: string, apiKey: string): CoreClient => {
    const coreFetch = (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set('x-api-key', apiKey);
      return fetch(`${apiBaseUrl}/core${path}`, {
        cache: 'no-store',
        ...init,
        headers,
      });
    };
    return { get: (path) => coreFetch(path), fetch: coreFetch };
  };

  const prepare = async (
    request: Request,
  ): Promise<Prepared<Session> | Response> => {
    // Read from a copy, so authenticate and rules can still read the request.
    const body =
      request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : await request.clone().arrayBuffer();

    // 1. Authenticate
    const authenticated = options.authenticate
      ? await options.authenticate(request)
      : undefined;
    if (authenticated instanceof Response) return authenticated;
    const session = authenticated ?? undefined;

    // 2. Choose the caller
    let caller: string | undefined;
    let entry: ProxyCaller<Session> | undefined;
    if (multiple) {
      caller = await options.caller?.({ session, request });
      const callers = options.callers ?? {};
      entry =
        caller !== undefined && hasOwn(callers, caller)
          ? callers[caller]
          : undefined;
    } else if (!options.authenticate || session !== undefined) {
      entry = options;
    }
    if (!entry) return unauthorized();
    if (!entry.apiKey) {
      return misconfigured(
        caller === undefined
          ? 'No apiKey is set'
          : `No apiKey is set for caller '${caller}'`,
      );
    }
    const apiBaseUrl = (options.apiBaseUrl ?? env('API_BASE_URL'))?.replace(
      /\/+$/,
      '',
    );
    if (!apiBaseUrl) {
      return misconfigured('No apiBaseUrl is set, and API_BASE_URL is empty');
    }

    // 3. Parse into operations
    const url = new URL(request.url);
    if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) {
      return json(404, {
        code: 'NOT_FOUND',
        message: `The proxy serves paths under ${basePath}`,
      });
    }
    const path = url.pathname.slice(basePath.length) || '/';
    const text = body ? new TextDecoder().decode(body) : '';
    let parsed: unknown;
    if (text.trim()) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // Custom routes may take other bodies; their rules see none.
        if (!path.startsWith('/app/')) {
          return json(400, {
            code: 'BAD_REQUEST',
            message: 'Request body must be JSON',
          });
        }
      }
    }
    const result = parseOperations({
      method: request.method,
      path,
      searchParams: url.searchParams,
      body: parsed,
      entityConfig,
    });
    if (!result.ok) {
      return json(result.status, {
        code: result.status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST',
        message: result.message,
      });
    }

    // 4. Check rules
    const context: RuleContext<Session> = {
      session,
      request,
      core: coreClient(apiBaseUrl, entry.apiKey),
    };
    const refusal = await checkOperations({
      operations: result.operations,
      rules: entry.rules,
      routes: entry.routes,
      context,
      logMissingRules,
    });
    if (refusal) return refusal;

    return {
      caller,
      session,
      apiKey: entry.apiKey,
      apiBaseUrl,
      target: `${path}${url.search}`,
      body: body && body.byteLength > 0 ? body : undefined,
      operations: result.operations,
    };
  };

  const checkRequest = async (
    request: Request,
  ): Promise<CheckResult<Session>> => {
    const prepared = await prepare(request);
    if (prepared instanceof Response) {
      return { allowed: false, response: prepared };
    }
    const { caller, session, operations } = prepared;
    return { allowed: true, caller, session, operations };
  };

  const handle = async (request: Request): Promise<Response> => {
    const prepared = await prepare(request);
    if (prepared instanceof Response) return prepared;

    // 5. Forward, with only the headers Core needs and the caller's key
    const headers = new Headers();
    for (const name of FORWARDED_HEADERS) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    headers.set('x-api-key', prepared.apiKey);

    let response: Response;
    try {
      response = await fetch(`${prepared.apiBaseUrl}/core${prepared.target}`, {
        method: request.method,
        headers,
        body: prepared.body,
        cache: 'no-store',
      });
    } catch (error) {
      console.error('[monorise/proxy] Monorise Core is unreachable', error);
      return json(502, {
        code: 'BAD_GATEWAY',
        message: 'Monorise Core is unreachable',
      });
    }

    // 6. Respond with Core's status and body
    const responseHeaders = new Headers(response.headers);
    for (const name of DROPPED_RESPONSE_HEADERS) responseHeaders.delete(name);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  };

  const alias: RequestHandler = (request) => handle(request);
  return {
    handle,
    checkRequest,
    GET: alias,
    POST: alias,
    PUT: alias,
    PATCH: alias,
    DELETE: alias,
  };
};
