import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// An app's rules as the type checker sees them: the generated config's
// augmentation of @monorise/base, then rules. Each `@ts-expect-error` line
// must fail to compile, and everything else must compile, or the test fails.
const rulesFile = `
import { createEntityConfig, Entity } from '@monorise/base';
import { z } from 'zod';
import {
  type EntityOperation,
  type ProxyRule,
  type ProxyRules,
  type RouteRules,
  allow,
  createProxyHandler,
  deny,
} from '../../../index';

declare module '@monorise/base' {
  export enum Entity {
    LEARNER = 'learner',
    COURSE = 'course',
    ORDER = 'order',
  }
  export interface EntitySchemaMap {
    [Entity.LEARNER]: { name?: string; courseIds?: string[] };
    [Entity.COURSE]: { name?: string };
    [Entity.ORDER]: { total?: number; status?: string };
  }
  export interface ApiKeyMutualDataFields {
    [Entity.LEARNER]: { [Entity.COURSE]: 'role' | 'appliedAt' };
    [Entity.COURSE]: { [Entity.LEARNER]: 'role' | 'appliedAt' };
  }
}

type Session = { userId: string; learnerId?: string };

// A shared rule fits under any entity, action or relationship.
const isMine: ProxyRule<Session> = (op, { session }) =>
  (op.kind === 'relationship' ? op.byEntityId : op.kind === 'entity' ? op.entityId : undefined) ===
  session?.userId;

const rules: ProxyRules<Session> = {
  '*': { list: allow, read: allow, delete: deny },
  [Entity.ORDER]: {
    get: isMine,
    update: (op, { session }) => {
      const type: Entity.ORDER = op.entityType;
      const action: 'update' = op.action;
      return op.payload?.status !== 'paid' && session?.userId !== undefined;
    },
    '*': (op) => op.entityType === Entity.ORDER,
    // An adjust carries amounts for the numeric fields, and no payload.
    adjust: (op) => {
      const action: 'adjust' = op.action;
      return (op.adjustments?.total ?? 0) >= 0;
    },
  },
  [Entity.LEARNER]: {
    create: isMine,
    mutuals: {
      [Entity.COURSE]: {
        read: (op, { session }) => op.byEntityId === session?.learnerId,
        create: (op) => {
          const by: Entity.LEARNER = op.byEntityType;
          const to: Entity.COURSE = op.entityType;
          return op.payload?.role !== 'teacher';
        },
        '*': isMine,
      },
      '*': { read: allow },
    },
  },
  [Entity.COURSE]: (op) =>
    op.kind === 'entity' ? op.entityType === Entity.COURSE : op.byEntityType === Entity.COURSE,
};

const routes: RouteRules<Session> = {
  'POST /app/invite': (op, { session }) =>
    (op.body as { userId?: string } | undefined)?.userId === session?.userId,
  'PATCH /app/activity/:id/reschedule': (op) => op.params?.id !== undefined,
  '*': deny,
};

// A rule can be written for one entity and action, then reused.
const notPaid: ProxyRule<Session, EntityOperation<Entity.ORDER, 'update'>> = (op) =>
  op.payload?.status !== 'paid';
const reused: ProxyRules<Session> = { [Entity.ORDER]: { update: notPaid } };

// The generated config, with everything else it exports.
const config = {
  EntityConfig: {
    [Entity.LEARNER]: createEntityConfig({
      name: 'learner',
      displayName: 'Learner',
      baseSchema: z.object({ name: z.string() }).partial(),
      mutual: {
        mutualSchema: z.object({ courseIds: z.string().array() }).partial(),
        mutualFields: { courseIds: { entityType: Entity.COURSE } },
      },
    }),
  },
  AllowedEntityTypes: [Entity.LEARNER],
};

const proxy = createProxyHandler({
  config,
  authenticate: (request: Request): Session | undefined =>
    request.headers.get('cookie') ? { userId: 'u1' } : undefined,
  caller: ({ session }) => (session ? 'user' : undefined),
  callers: {
    user: { apiKey: 'k', rules, routes },
    // Session is inferred from authenticate.
    inline: { apiKey: 'k', rules: { [Entity.ORDER]: (op, { session }) => session?.userId === 'u1' } },
  },
});
export const { GET, POST } = proxy;

createProxyHandler({ config, apiKey: 'admin-key', rules: { '*': allow } });

// @ts-expect-error a misspelled entity type
const r1: ProxyRules<Session> = { ordr: allow };
// @ts-expect-error a misspelled payload field
const r2: ProxyRules<Session> = { [Entity.ORDER]: { update: (op) => op.payload?.totl === 1 } };
// @ts-expect-error a misspelled mutualData field
const r3: ProxyRules<Session> = { [Entity.LEARNER]: { mutuals: { [Entity.COURSE]: { create: (op) => op.payload?.rol === 'x' } } } };
// @ts-expect-error a misspelled relationship target
const r4: ProxyRules<Session> = { [Entity.LEARNER]: { mutuals: { corse: allow } } };
// @ts-expect-error read is a relationship action; entities have get and list
const r5: ProxyRules<Session> = { [Entity.ORDER]: { read: allow } };
// @ts-expect-error session fields are typed
const r6: ProxyRules<Session> = { [Entity.ORDER]: (op, { session }) => session?.userid === 'u' };
// @ts-expect-error a rule returns a boolean or a Response
const r7: ProxyRules<Session> = { [Entity.ORDER]: () => 'yes' };
// @ts-expect-error a rule for another entity's operations
const r8: ProxyRules<Session> = { [Entity.COURSE]: { update: notPaid } };
// @ts-expect-error a route is keyed by a method and a path under /app
const r9: RouteRules<Session> = { '/app/invite': allow };
// @ts-expect-error an adjust has no payload
const r10: ProxyRules<Session> = { [Entity.ORDER]: { adjust: (op) => op.payload?.total === 1 } };
// @ts-expect-error only numeric fields can be adjusted
const r11: ProxyRules<Session> = { [Entity.ORDER]: { adjust: (op) => op.adjustments?.status === 1 } };
// @ts-expect-error an update has no adjustments
const r12: ProxyRules<Session> = { [Entity.ORDER]: { update: (op) => op.adjustments?.total === 1 } };
// A shared rule fits under adjust too, and a materialized entity's create
// rule can see the relationship it comes from.
const r13: ProxyRules<Session> = {
  [Entity.ORDER]: { adjust: isMine },
  [Entity.COURSE]: { create: (op) => op.asEntityOf?.byEntityType === Entity.LEARNER },
};
// @ts-expect-error caller and callers don't mix with apiKey
createProxyHandler({ config, caller: () => 'a', callers: {}, apiKey: 'k' });
// @ts-expect-error config is required
createProxyHandler({ apiKey: 'k', rules: { '*': allow } });
`;

describe('rule types', () => {
  it('type rules from the generated Entity, EntitySchemaMap and mutual config', () => {
    // Inside the package tree, so '@monorise/base' resolves to the built
    // package, as it does in a project.
    const dir = fs.mkdtempSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '.types-'),
    );
    try {
      const file = path.join(dir, 'proxy-rules.ts');
      fs.writeFileSync(file, rulesFile);

      const program = ts.createProgram([file], {
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
        types: [],
      });
      const problems = ts
        .getPreEmitDiagnostics(program)
        .filter((diagnostic) => diagnostic.file?.fileName === file)
        .map((diagnostic) => {
          const { line } = ts.getLineAndCharacterOfPosition(
            diagnostic.file as ts.SourceFile,
            diagnostic.start ?? 0,
          );
          return `line ${line + 1}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`;
        });

      expect(problems).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
