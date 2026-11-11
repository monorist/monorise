import assert from 'node:assert/strict';
import test from 'node:test';
import { apiKeyTypeDeclarations } from './api-key-types';

const schema = (...fields: string[]) => ({
  shape: Object.fromEntries(fields.map((field) => [field, {}])),
});

test('apiKeyTypeDeclarations declares tag names, and never for an entity without tags', () => {
  const declarations = apiKeyTypeDeclarations([
    {
      name: 'order',
      enumKey: 'ORDER',
      config: { tags: [{ name: 'region' }, { name: 'placed-at' }] },
    },
    { name: 'user-profile', enumKey: 'USER_PROFILE', config: {} },
  ]);

  assert.match(
    declarations,
    /export interface ApiKeyEntityTags \{\n {4}\[Entity\.ORDER\]: "region" \| "placed-at";\n {4}\[Entity\.USER_PROFILE\]: never;\n {2}\}/,
  );
});

test('apiKeyTypeDeclarations declares mutualData fields for both directions of a configured pair', () => {
  const declarations = apiKeyTypeDeclarations([
    {
      name: 'learner',
      enumKey: 'LEARNER',
      config: {
        mutual: {
          mutualFields: {
            courseIds: {
              entityType: 'course',
              mutual: { mutualDataSchema: schema('role', 'appliedAt') },
            },
            // No mutual config: free-form mutualData, left untyped.
            organisationIds: { entityType: 'organisation' },
          },
        },
      },
    },
    { name: 'course', enumKey: 'COURSE', config: {} },
    { name: 'organisation', enumKey: 'ORGANISATION', config: {} },
  ]);

  assert.match(
    declarations,
    /export interface ApiKeyMutualDataFields \{\n {4}\[Entity\.LEARNER\]: \{\n {6}\[Entity\.COURSE\]: "role" \| "appliedAt";\n {4}\};\n {4}\[Entity\.COURSE\]: \{\n {6}\[Entity\.LEARNER\]: "role" \| "appliedAt";\n {4}\};\n {2}\}/,
  );
  assert.doesNotMatch(declarations, /ORGANISATION\]: \{/);
});

test("apiKeyTypeDeclarations prefers each side's own mutual config for its direction", () => {
  const declarations = apiKeyTypeDeclarations([
    {
      name: 'learner',
      enumKey: 'LEARNER',
      config: {
        mutual: {
          mutualFields: {
            courseIds: {
              entityType: 'course',
              mutual: { mutualDataSchema: schema('role') },
            },
          },
        },
      },
    },
    {
      name: 'course',
      enumKey: 'COURSE',
      config: {
        mutual: {
          mutualFields: {
            learnerIds: {
              entityType: 'learner',
              mutual: { mutualDataSchema: schema('seat') },
            },
          },
        },
      },
    },
  ]);

  assert.match(
    declarations,
    /\[Entity\.LEARNER\]: \{\n {6}\[Entity\.COURSE\]: "role";/,
  );
  assert.match(
    declarations,
    /\[Entity\.COURSE\]: \{\n {6}\[Entity\.LEARNER\]: "seat";/,
  );
});

test('apiKeyTypeDeclarations skips a relationship to an entity that has no config', () => {
  const declarations = apiKeyTypeDeclarations([
    {
      name: 'learner',
      enumKey: 'LEARNER',
      config: {
        mutual: {
          mutualFields: {
            ghostIds: {
              entityType: 'ghost',
              mutual: { mutualDataSchema: schema('x') },
            },
          },
        },
      },
    },
  ]);

  assert.doesNotMatch(declarations, /ghost|undefined/i);
});
