import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  type ApiKeyPolicies,
  type Entity as EntityType,
  compileApiKeyPolicy,
  createEntityConfig,
  createMutualConfig,
  defineApiKeyPolicies,
  validateApiKeyPolicies,
} from '../../../base';
import { apiKeyAuth, fingerprintApiKey } from '../api-key-auth';

const as = (name: string) => name as unknown as EntityType;

const enrollment = createEntityConfig({
  name: 'enrollment',
  displayName: 'Enrollment',
  baseSchema: z.object({ role: z.string() }).partial(),
});

const learnerCourse = createMutualConfig({
  entities: [as('learner'), as('course')],
  mutualDataSchema: z.object({ role: z.string(), appliedAt: z.string() }),
});

const learnerEnrollment = createMutualConfig({
  entities: [as('learner'), as('cohort')],
  asEntity: enrollment,
});

const entityConfig = {
  learner: createEntityConfig({
    name: 'learner',
    displayName: 'Learner',
    baseSchema: z
      .object({ displayName: z.string(), email: z.string() })
      .partial(),
    createSchema: z.object({ displayName: z.string() }),
    mutual: {
      mutualSchema: z
        .object({
          courseIds: z.string().array(),
          cohortIds: z.string().array(),
        })
        .partial(),
      mutualFields: {
        courseIds: { entityType: as('course'), mutual: learnerCourse },
        cohortIds: { entityType: as('cohort'), mutual: learnerEnrollment },
      },
    },
    tags: [{ name: 'region', processor: () => [] }],
  }),
  course: createEntityConfig({
    name: 'course',
    displayName: 'Course',
    baseSchema: z
      .object({ title: z.string(), price: z.number(), status: z.string() })
      .partial(),
    createSchema: z.object({
      title: z.string(),
      status: z.string().default('draft'),
    }),
  }),
  organisation: createEntityConfig({
    name: 'organisation',
    displayName: 'Organisation',
    baseSchema: z.object({ name: z.string() }).partial(),
  }),
  competition: createEntityConfig({
    name: 'competition',
    displayName: 'Competition',
    baseSchema: z.object({ name: z.string() }).partial(),
    mutual: {
      mutualSchema: z.object({ organisationIds: z.string().array() }).partial(),
      createMutualSchema: z.object({ organisationIds: z.string().array() }),
      mutualFields: {
        organisationIds: { entityType: as('organisation') },
      },
    },
  }),
  cohort: createEntityConfig({
    name: 'cohort',
    displayName: 'Cohort',
    baseSchema: z.object({ name: z.string() }).partial(),
  }),
  enrollment,
} as const;

const fields = (...names: string[]) => new Set(names);

describe('compileApiKeyPolicy', () => {
  it('grants everything to the built-in full policy', () => {
    const full = compileApiKeyPolicy('full');

    expect(full.full).toBe(true);
    expect(full.entity('anything')).toEqual({
      listed: true,
      read: '*',
      create: '*',
      update: '*',
      delete: true,
      tags: '*',
    });
    expect(full.mutual('learner', 'course')).toEqual({
      read: '*',
      create: '*',
      update: '*',
      delete: true,
    });
  });

  it('ignores a policy passed under the name full', () => {
    expect(compileApiKeyPolicy('full', 'read').entity('course').delete).toBe(
      true,
    );
  });

  it("applies a policy-level 'read' to every entity and relationship", () => {
    const policy = compileApiKeyPolicy('agent-read', 'read');

    expect(policy.full).toBe(false);
    expect(policy.entity('course')).toMatchObject({
      listed: true,
      read: '*',
      create: null,
      update: null,
      delete: false,
    });
    expect(policy.mutual('course', 'learner')).toEqual({
      read: '*',
      create: null,
      update: null,
      delete: false,
    });
  });

  it('leaves unlisted entity types unlisted, and uses the * entry for the rest', () => {
    const policy = compileApiKeyPolicy('support', {
      entities: { '*': 'read', [as('payment')]: 'none' },
    });

    expect(policy.entity('course').listed).toBe(true);
    expect(policy.entity('payment').listed).toBe(false);
    expect(compileApiKeyPolicy('empty', {}).entity('course').listed).toBe(
      false,
    );
  });

  it('makes every write list readable, without system fields', () => {
    const policy = compileApiKeyPolicy('client', {
      entities: {
        [as('order')]: {
          read: ['total'],
          create: ['customerId', '$entityId'],
          update: ['status'],
        },
      },
    });

    expect(policy.entity('order')).toEqual({
      listed: true,
      read: fields('total', 'customerId', 'status'),
      create: fields('customerId', '$entityId'),
      update: fields('status'),
      delete: false,
      tags: null,
    });
  });

  it('treats write as create plus update', () => {
    const order = compileApiKeyPolicy('client', {
      entities: { [as('order')]: { write: ['notes'], create: ['items'] } },
    }).entity('order');

    expect(order.create).toEqual(fields('items', 'notes'));
    expect(order.update).toEqual(fields('notes'));
  });

  it("defaults tags to all only when read is '*'", () => {
    const policy = compileApiKeyPolicy('client', {
      entities: {
        [as('order')]: { read: '*' },
        [as('user')]: { read: ['name'] },
        [as('product')]: { read: ['name'], tags: ['region'] },
      },
    });

    expect(policy.entity('order').tags).toBe('*');
    expect(policy.entity('user').tags).toBeNull();
    expect(policy.entity('product').tags).toEqual(fields('region'));
  });

  describe('mutual directions', () => {
    const policy = compileApiKeyPolicy('client', {
      entities: {
        [as('learner')]: {
          read: '*',
          mutuals: {
            [as('course')]: { read: '*', create: ['role'], delete: true },
          },
        },
        [as('course')]: 'read',
        [as('product')]: 'write',
        [as('category')]: { read: '*', mutuals: { '*': 'read' } },
        [as('brand')]: { read: '*' },
      },
    });

    it('uses the entry under the first entity in the URL', () => {
      expect(policy.mutual('learner', 'course')).toEqual({
        read: '*',
        create: fields('role'),
        update: null,
        delete: true,
      });
    });

    it('never mirrors an entry to the opposite direction', () => {
      // course is 'read', so course→learner falls back to read only.
      expect(policy.mutual('course', 'learner')).toEqual({
        read: '*',
        create: null,
        update: null,
        delete: false,
      });
    });

    it("defaults a shorthand entity's directions to its level", () => {
      expect(policy.mutual('product', 'course')?.create).toBe('*');
      expect(policy.mutual('course', 'product')?.create).toBeNull();
    });

    it("defaults an object entity's directions to its mutuals['*'], or none", () => {
      expect(policy.mutual('category', 'course')?.read).toBe('*');
      expect(policy.mutual('brand', 'course')).toEqual({
        read: null,
        create: null,
        update: null,
        delete: false,
      });
    });

    it('returns null when either end type is unlisted', () => {
      expect(policy.mutual('learner', 'payment')).toBeNull();
      expect(policy.mutual('payment', 'learner')).toBeNull();
    });
  });
});

describe('validateApiKeyPolicies', () => {
  const validate = (policies: unknown) =>
    validateApiKeyPolicies(policies, entityConfig);

  it('accepts valid policies', () => {
    expect(
      validate({
        'agent-read': 'read',
        writer: 'write',
        client: {
          entities: {
            learner: {
              read: '*',
              create: ['displayName', '$entityId'],
              update: ['displayName'],
              tags: ['region'],
              mutuals: {
                course: { read: ['role'], create: ['role'], delete: true },
                '*': 'read',
              },
            },
            course: { read: ['title', 'price'] },
          },
        },
      }),
    ).toEqual([]);
  });

  it.each<[string, unknown, string]>([
    ['redefining full', { full: 'read' }, "policy 'full' is built in"],
    [
      'a policy that is not read, write or an object',
      { p: 'all' },
      "must be 'read', 'write' or an object",
    ],
    ['an unknown policy key', { p: { entity: {} } }, "unknown key 'entity'"],
    [
      'an unknown entity type',
      { p: { entities: { lerner: 'read' } } },
      "unknown entity type 'lerner'",
    ],
    [
      'an invalid * level',
      { p: { entities: { '*': 'all' } } },
      "entities.* must be one of 'none', 'read', 'write'",
    ],
    [
      'an unknown grant key',
      { p: { entities: { course: { reed: '*' } } } },
      "unknown key 'reed'",
    ],
    [
      'an unknown field',
      { p: { entities: { course: { read: ['titel'] } } } },
      "course.read: unknown field 'titel'",
    ],
    [
      'a field list that is not an array',
      { p: { entities: { course: { read: 'title' } } } },
      "must be '*' or an array of field names",
    ],
    [
      'a relationship field in an entity list',
      { p: { entities: { learner: { update: ['courseIds'] } } } },
      "'courseIds' is a relationship field",
    ],
    [
      'a system field outside create or write',
      { p: { entities: { course: { update: ['$createdAt'] } } } },
      "'$createdAt' can only be granted in 'create' or 'write'",
    ],
    [
      'a non-boolean delete',
      { p: { entities: { course: { delete: 'yes' } } } },
      'course.delete must be a boolean',
    ],
    [
      'an unknown tag',
      { p: { entities: { learner: { tags: ['regoin'] } } } },
      "learner.tags: unknown field 'regoin'",
    ],
    [
      'an unknown mutual target',
      { p: { entities: { learner: { mutuals: { cours: 'read' } } } } },
      "unknown entity type 'cours'",
    ],
    [
      'an unknown mutualData field',
      {
        p: {
          entities: { learner: { mutuals: { course: { read: ['rol'] } } } },
        },
      },
      "mutuals.course.read: unknown field 'rol'",
    ],
    [
      'an unknown mutual grant key',
      { p: { entities: { learner: { mutuals: { course: { tags: '*' } } } } } },
      "unknown key 'tags'",
    ],
  ])('rejects %s', (_, policies, message) => {
    expect(validate(policies).join('\n')).toContain(message);
  });

  it('checks mutualData fields in either direction of a declared mutual', () => {
    expect(
      validate({
        p: {
          entities: { course: { mutuals: { learner: { read: ['rol'] } } } },
        },
      }).join('\n'),
    ).toContain("unknown field 'rol'");
  });

  it('allows any mutualData field when the pair declares no mutual config', () => {
    expect(
      validate({
        p: {
          entities: {
            course: { mutuals: { organisation: { read: ['anything'] } } },
            organisation: 'read',
          },
        },
      }),
    ).toEqual([]);
  });

  it('rejects a create list that omits a required field', () => {
    expect(
      validate({ p: { entities: { course: { create: ['price'] } } } }),
    ).toEqual([
      "policy 'p'.entities.course: create omits required field(s) 'title', so a key with this policy could never create one",
    ]);
  });

  it('does not require fields that have a default', () => {
    expect(
      validate({ p: { entities: { course: { create: ['title'] } } } }),
    ).toEqual([]);
  });

  it('requires create on the direction createMutualSchema requires', () => {
    const errors = validate({
      p: {
        entities: { competition: { create: '*' }, organisation: 'read' },
      },
    });

    expect(errors).toEqual([
      "policy 'p'.entities.competition: create needs create on competition→organisation, because createMutualSchema requires 'organisationIds'",
    ]);
    expect(
      validate({
        p: {
          entities: {
            competition: {
              create: '*',
              mutuals: { organisation: { create: '*' } },
            },
            organisation: 'read',
          },
        },
      }),
    ).toEqual([]);
  });

  it('requires create on the asEntity type when a direction can create the mutual', () => {
    const policy = {
      entities: {
        learner: { read: '*', mutuals: { cohort: 'write' } },
        cohort: 'read',
        enrollment: 'read',
      },
    };

    expect(validate({ p: policy }).join('\n')).toContain(
      "create on learner→cohort also creates a 'enrollment' entity, so it needs create on 'enrollment'",
    );
    expect(
      validate({
        p: { entities: { ...policy.entities, enrollment: 'write' } },
      }),
    ).toEqual([]);
  });

  it('reports every policy, not only the first with an error', () => {
    const errors = validate({
      a: { entities: { lerner: 'read' } },
      b: { entities: { course: { create: ['price'] } } },
    });

    expect(errors).toHaveLength(2);
  });
});

describe('defineApiKeyPolicies', () => {
  it('returns the policies with a non-enumerable validator for the CLI', () => {
    const policies = { p: { entities: { lerner: 'read' } } } as ApiKeyPolicies;

    const defined = defineApiKeyPolicies(policies);
    const validator = (defined as Record<symbol, unknown>)[
      Symbol.for('monorise.validateApiKeyPolicies')
    ] as (configs: typeof entityConfig) => string[];

    expect(defined).toBe(policies);
    expect(Object.keys(defined)).toEqual(['p']);
    expect(validator(entityConfig)).toEqual([
      "policy 'p'.entities.lerner: unknown entity type 'lerner'",
    ]);
  });
});

describe('apiKeyAuth', () => {
  it('accepts keys under policies the project defines', async () => {
    const { Hono } = await import('hono');
    const app = new Hono();
    app.use(
      apiKeyAuth({
        policies: { reporting: 'read' },
        entityConfig,
        apiKeys: '{"full": ["a"], "reporting": ["b"]}',
      }),
    );
    app.get('/', (c) => c.json(c.get('apiKey')));

    const res = await app.request('/', { headers: { 'x-api-key': 'b' } });

    expect(await res.json()).toEqual({
      policy: 'reporting',
      fingerprint: fingerprintApiKey('b'),
      access: { name: 'reporting', full: false },
    });
  });

  it('throws at cold start when the policies are invalid', () => {
    expect(() =>
      apiKeyAuth({
        policies: { reporting: { entities: { lerner: 'read' } } },
        entityConfig,
        apiKeys: '[]',
      }),
    ).toThrow(/Invalid API key policies:\n {2}- policy 'reporting'/);
  });
});
