import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  type Entity as EntityType,
  createEntityConfig,
  createMutualConfig,
} from '../../../base';
import { apiKeyTypeDeclarations } from '../../../cli/commands/utils/api-key-types';

const as = (name: string) => name as unknown as EntityType;
const named = (name: string) =>
  createEntityConfig({
    name,
    displayName: name,
    baseSchema: z.object({ name: z.string() }).partial(),
  });

// The declarations the CLI generates, from real configs.
const declarations = apiKeyTypeDeclarations([
  {
    name: 'learner',
    enumKey: 'LEARNER',
    config: createEntityConfig({
      name: 'learner',
      displayName: 'Learner',
      baseSchema: z.object({ name: z.string() }).partial(),
      mutual: {
        mutualSchema: z.object({ courseIds: z.string().array() }).partial(),
        mutualFields: {
          courseIds: {
            entityType: as('course'),
            mutual: createMutualConfig({
              entities: [as('learner'), as('course')],
              mutualDataSchema: z.object({
                role: z.string(),
                appliedAt: z.string(),
              }),
            }),
          },
        },
      },
    }) as never,
  },
  { name: 'course', enumKey: 'COURSE', config: named('course') as never },
  {
    name: 'order',
    enumKey: 'ORDER',
    config: createEntityConfig({
      name: 'order',
      displayName: 'Order',
      baseSchema: z.object({ total: z.number() }).partial(),
      tags: [{ name: 'region', processor: () => [] }],
    }) as never,
  },
]);

// A project's policy file as the type checker sees it: the generated config's
// augmentation of @monorise/base, then policies. Each `@ts-expect-error` line
// must fail to compile, and everything else must compile, or the test fails.
const policyFile = `
import { defineApiKeyPolicies, Entity } from '@monorise/base';

declare module '@monorise/base' {
  export enum Entity {
    LEARNER = 'learner',
    COURSE = 'course',
    ORDER = 'order',
  }
  export interface EntitySchemaMap {
    [Entity.LEARNER]: { name?: string; courseIds?: string[] };
    [Entity.COURSE]: { name?: string };
    [Entity.ORDER]: { total?: number };
  }
${declarations}
}

defineApiKeyPolicies({
  valid: {
    entities: {
      [Entity.ORDER]: { read: ['total'], tags: ['region'] },
      [Entity.LEARNER]: {
        read: '*',
        mutuals: { [Entity.COURSE]: { read: ['role'], create: ['role', 'appliedAt'] } },
      },
      [Entity.COURSE]: {
        read: '*',
        mutuals: {
          [Entity.LEARNER]: { read: ['appliedAt'] },
          // No mutual config between course and order: any field compiles.
          [Entity.ORDER]: { read: ['anything'] },
        },
      },
    },
  },
});

// @ts-expect-error a misspelled tag
defineApiKeyPolicies({ p: { entities: { [Entity.ORDER]: { tags: ['regoin'] } } } });
// @ts-expect-error a tag on an entity that has none
defineApiKeyPolicies({ p: { entities: { [Entity.LEARNER]: { tags: ['region'] } } } });
// @ts-expect-error a misspelled mutualData field
defineApiKeyPolicies({ p: { entities: { [Entity.LEARNER]: { mutuals: { [Entity.COURSE]: { read: ['rol'] } } } } } });
// @ts-expect-error the opposite direction of a configured pair is typed too
defineApiKeyPolicies({ p: { entities: { [Entity.COURSE]: { mutuals: { [Entity.LEARNER]: { update: ['rol'] } } } } } });
// @ts-expect-error a misspelled entity field
defineApiKeyPolicies({ p: { entities: { [Entity.ORDER]: { read: ['totl'] } } } });
`;

describe('policy types', () => {
  it('type tags and mutualData fields from the generated declarations', () => {
    // Inside the package tree, so '@monorise/base' resolves to the built
    // package, as it does in a project.
    const dir = fs.mkdtempSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '.types-'),
    );
    try {
      const file = path.join(dir, 'api-keys.ts');
      fs.writeFileSync(file, policyFile);

      const program = ts.createProgram([file], {
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
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
