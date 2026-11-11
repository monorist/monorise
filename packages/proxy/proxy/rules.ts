import type {
  EntityAction,
  EntityOperation,
  ProxyOperation,
  RelationshipAction,
  RelationshipOperation,
  RouteOperation,
} from './operations';

/** Calls Monorise Core with the request's key, for checks such as "is this record in my organization?". */
export type CoreClient = {
  /** A path under `/core`, e.g. `/mutual/hirer-organization/h1/project/p1`. */
  get(path: string): Promise<Response>;
  fetch(path: string, init?: RequestInit): Promise<Response>;
};

export type RuleContext<Session> = {
  /** What `authenticate` returned; `undefined` for an anonymous visitor. */
  session: Session | undefined;
  request: Request;
  core: CoreClient;
};

/**
 * `true` forwards the operation; `false` refuses it with 403; a `Response`
 * is sent back as is. Only `true` forwards, so a rule that forgets to return
 * fails closed.
 */
export type RuleResult = boolean | Response;

export type ProxyRule<Operation = ProxyOperation, Session = unknown> = (
  operation: Operation,
  context: RuleContext<Session>,
) => RuleResult | Promise<RuleResult>;

/** A rule for operations that need no ownership check: the key alone decides. */
export const allow = (): RuleResult => true;

/** A rule that always refuses. */
export const deny = (): RuleResult => false;

// biome-ignore lint/suspicious/noExplicitAny: a rule written for any operation or session
type AnyRule = ProxyRule<any, any>;

export type RelationshipRules<Session = unknown> =
  | ProxyRule<RelationshipOperation, Session>
  | Partial<
      Record<
        RelationshipAction | '*',
        ProxyRule<RelationshipOperation, Session>
      >
    >;

/**
 * Rules for one entity type. A single rule covers every action on the entity
 * and its relationships. An object names actions, with `'*'` for the rest of
 * the entity's actions, and `mutuals` for relationships from it.
 */
export type EntityRules<Session = unknown> =
  | ProxyRule<EntityOperation | RelationshipOperation, Session>
  | (Partial<
      Record<EntityAction | '*', ProxyRule<EntityOperation, Session>>
    > & {
      mutuals?: Record<string, RelationshipRules<Session>>;
    });

/**
 * Rules keyed by entity type. `'*'` applies to anything the table doesn't
 * name: a single rule for every operation, or rules per action.
 */
export type ProxyRules<Session = unknown> = {
  '*'?:
    | AnyRule
    | Partial<
        Record<
          EntityAction | RelationshipAction,
          ProxyRule<EntityOperation | RelationshipOperation, Session>
        >
      >;
} & Record<string, EntityRules<Session> | AnyRule | object | undefined>;

/**
 * Rules for custom routes, keyed by `'METHOD /app/path'`. A `:param` segment
 * matches any one segment and a trailing `*` matches the rest; `'*'` applies
 * to every route the table doesn't name.
 */
export type RouteRules<Session = unknown> = Record<
  string,
  ProxyRule<RouteOperation, Session>
>;

const hasOwn = (object: object, key: string) =>
  Object.prototype.hasOwnProperty.call(object, key);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const own = (object: unknown, key: string): unknown =>
  isRecord(object) && hasOwn(object, key) ? object[key] : undefined;

const asRule = (value: unknown): AnyRule | undefined =>
  typeof value === 'function' ? (value as AnyRule) : undefined;

// A single rule, or the rule an object of rules names for this action.
const ruleFor = (value: unknown, action: string) =>
  asRule(value) ?? asRule(own(value, action));

type RouteMatch = { rule: AnyRule; params: Record<string, string> };

// The first position where two ranks differ decides; a tie keeps the earlier.
const outranks = (rank: number[], than: number[]) => {
  const index = rank.findIndex((value, at) => value !== than[at]);
  return index !== -1 && rank[index] > than[index];
};

/**
 * The most specific route rule wins, whatever order the table lists them in:
 * more literal segments first, then a pattern without a trailing `*`, then
 * fewer `:param`s. Declaration order only breaks ties.
 */
const matchRoute = (
  routes: RouteRules<unknown> | undefined,
  operation: RouteOperation,
): RouteMatch | undefined => {
  if (!routes) return undefined;

  const exact = asRule(own(routes, `${operation.method} ${operation.path}`));
  if (exact) return { rule: exact, params: {} };

  const segments = operation.path.split('/').filter(Boolean);
  let best: { match: RouteMatch; rank: number[] } | undefined;
  for (const [key, rule] of Object.entries(routes)) {
    const [method, pattern] = key.split(' ');
    if (method !== operation.method || !pattern || typeof rule !== 'function') {
      continue;
    }
    const parts = pattern.split('/').filter(Boolean);
    const params: Record<string, string> = {};
    const rest = parts.at(-1) === '*';
    const fixed = rest ? parts.slice(0, -1) : parts;
    if (
      rest ? segments.length < fixed.length : segments.length !== fixed.length
    ) {
      continue;
    }
    const matches = fixed.every((part, index) => {
      if (part.startsWith(':')) {
        params[part.slice(1)] = segments[index];
        return true;
      }
      return part === segments[index];
    });
    if (!matches) continue;

    const paramCount = fixed.filter((part) => part.startsWith(':')).length;
    // Compared in order; a higher number is more specific.
    const rank = [fixed.length - paramCount, rest ? 0 : 1, -paramCount];
    if (!best || outranks(rank, best.rank)) {
      best = { match: { rule, params }, rank };
    }
  }
  return best?.match;
};

/**
 * Finds the rule for an operation. The most specific match wins:
 *
 * | Entity operation | Relationship operation | Route |
 * | `rules[entity][action]` | `rules[by].mutuals[target][action]` | `routes['METHOD /app/…']` |
 * | `rules[entity]['*']`, or `rules[entity]` as a single rule | `rules[by].mutuals[target]['*']`, then `rules[by].mutuals['*']`, or `rules[by]` as a single rule | `routes['*']` |
 * | `rules['*'][action]`, or `rules['*']` as a single rule | the same | `rules['*']` as a single rule |
 *
 * `undefined` means no rule: the operation is refused.
 */
export const findRule = (
  rules: ProxyRules<never> | undefined,
  routes: RouteRules<never> | undefined,
  operation: ProxyOperation,
): { rule: AnyRule; operation: ProxyOperation } | undefined => {
  const tableFallback = own(rules, '*');
  const found = (rule: AnyRule | undefined, matched = operation) =>
    rule ? { rule, operation: matched } : undefined;

  if (operation.kind === 'entity') {
    const entity = own(rules, operation.entityType);
    return found(
      asRule(entity) ??
        asRule(own(entity, operation.action)) ??
        asRule(own(entity, '*')) ??
        ruleFor(tableFallback, operation.action),
    );
  }

  if (operation.kind === 'relationship') {
    const entity = own(rules, operation.byEntityType);
    const mutuals = own(entity, 'mutuals');
    return found(
      asRule(entity) ??
        ruleFor(own(mutuals, operation.entityType), operation.action) ??
        asRule(own(own(mutuals, operation.entityType), '*')) ??
        ruleFor(own(mutuals, '*'), operation.action) ??
        ruleFor(tableFallback, operation.action),
    );
  }

  const route = matchRoute(
    routes as RouteRules<unknown> | undefined,
    operation,
  );
  if (route) return found(route.rule, { ...operation, params: route.params });
  return found(asRule(own(routes, '*')) ?? asRule(tableFallback));
};

/** How a refusal names an operation, e.g. `delete on 'hirer-schedule'`. */
export const describeOperation = (operation: ProxyOperation) =>
  operation.kind === 'entity'
    ? `${operation.action} on '${operation.entityType}'`
    : operation.kind === 'relationship'
      ? `${operation.action} on ${operation.byEntityType}→${operation.entityType}`
      : `${operation.method} ${operation.path}`;

// The rule to add, shaped for the operation, logged when one is missing.
const missingRuleHint = (operation: ProxyOperation) =>
  operation.kind === 'entity'
    ? `rules: { '${operation.entityType}': { ${operation.action}: (operation, { session }) => … } }`
    : operation.kind === 'relationship'
      ? `rules: { '${operation.byEntityType}': { mutuals: { '${operation.entityType}': { ${operation.action}: (operation, { session }) => … } } } }`
      : `routes: { '${operation.method} ${operation.path}': (operation, { session }) => … }`;

const forbidden = (message: string, operation: ProxyOperation) =>
  new Response(
    JSON.stringify({
      code: 'FORBIDDEN',
      message,
      ...('operationIndex' in operation &&
      operation.operationIndex !== undefined
        ? { operationIndex: operation.operationIndex }
        : {}),
    }),
    { status: 403, headers: { 'content-type': 'application/json' } },
  );

/**
 * Runs the rule for every operation, in order, and stops at the first
 * refusal. `undefined` means every operation may go ahead.
 */
export const checkOperations = async <Session>({
  operations,
  rules,
  routes,
  context,
  logMissingRules = false,
}: {
  operations: ProxyOperation[];
  rules?: ProxyRules<Session>;
  routes?: RouteRules<Session>;
  context: RuleContext<Session>;
  logMissingRules?: boolean;
}): Promise<Response | undefined> => {
  for (const operation of operations) {
    const found = findRule(
      rules as ProxyRules<never> | undefined,
      routes as RouteRules<never> | undefined,
      operation,
    );
    if (!found) {
      if (logMissingRules) {
        console.warn(
          `[monorise/proxy] No rule for ${describeOperation(operation)}. Add one: ${missingRuleHint(operation)}`,
        );
      }
      return forbidden(
        `No proxy rule for ${describeOperation(operation)}`,
        operation,
      );
    }

    const result = await found.rule(found.operation, context);
    if (result instanceof Response) return result;
    if (result !== true) {
      return forbidden(
        `Proxy rule refused ${describeOperation(operation)}`,
        operation,
      );
    }
  }
  return undefined;
};
