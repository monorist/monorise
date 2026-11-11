import { describe, expect, it, vi } from 'vitest';
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
      visible: true,
      read: '*',
      list: true,
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
      visible: true,
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

    expect(policy.entity('course').visible).toBe(true);
    expect(policy.entity('payment').visible).toBe(false);
    expect(compileApiKeyPolicy('empty', {}).entity('course').visible).toBe(
      false,
    );
  });

  it('treats entity types named like Object.prototype members as unlisted', () => {
    const policy = compileApiKeyPolicy('client', {
      entities: { [as('course')]: 'read' },
    });
    const wildcard = compileApiKeyPolicy('support', {
      entities: { '*': 'read' },
    });

    for (const name of [
      'constructor',
      '__proto__',
      'toString',
      'hasOwnProperty',
    ]) {
      expect(policy.entity(name).visible).toBe(false);
      expect(policy.mutual('course', name)).toBeNull();
      expect(wildcard.entity(name)).toEqual(wildcard.entity('course'));
    }
  });

  it('shares one compiled grant for every type the policy does not name', () => {
    const policy = compileApiKeyPolicy('support', {
      entities: { '*': 'read', [as('payment')]: 'none' },
    });

    // The same object, not a new entry per type string a caller sends.
    expect(policy.entity('a')).toBe(policy.entity('b'));
    expect(policy.entity('payment')).not.toBe(policy.entity('a'));
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
      visible: true,
      read: fields('total', 'customerId', 'status'),
      list: false,
      create: fields('customerId', '$entityId'),
      update: fields('status'),
      delete: false,
      tags: null,
    });
  });

  it('lists only for shorthands and object grants that say list: true', () => {
    const policy = compileApiKeyPolicy('client', {
      entities: {
        '*': 'read',
        [as('order')]: { read: '*' },
        [as('product')]: { read: ['name'], list: true },
        [as('payment')]: 'none',
      },
    });

    expect(policy.entity('anything').list).toBe(true);
    expect(policy.entity('order').list).toBe(false);
    expect(policy.entity('product').list).toBe(true);
    expect(policy.entity('payment').list).toBe(false);
    expect(compileApiKeyPolicy('writer', 'write').entity('order').list).toBe(
      true,
    );
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

describe('allowsRoute', () => {
  it('grants the routes a policy lists, every route to full, and none to shorthands', () => {
    const client = compileApiKeyPolicy('client', {
      routes: ['checkout', 'checkout:discount'],
    });

    expect(client.allowsRoute('checkout')).toBe(true);
    expect(client.allowsRoute('checkout:refund')).toBe(false);
    expect(compileApiKeyPolicy('full').allowsRoute('anything')).toBe(true);
    expect(compileApiKeyPolicy('reader', 'read').allowsRoute('checkout')).toBe(
      false,
    );
    expect(compileApiKeyPolicy('writer', 'write').allowsRoute('checkout')).toBe(
      false,
    );
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
        support: { routes: ['reports', 'checkout:refund'] },
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
      'routes that are not an array of names',
      { p: { routes: 'checkout' } },
      "p'.routes must be an array of permission names",
    ],
    [
      'an empty route name',
      { p: { routes: [''] } },
      "p'.routes must be an array of permission names",
    ],
    [
      'an unknown entity type',
      { p: { entities: { lerner: 'read' } } },
      "unknown entity type 'lerner'",
    ],
    [
      'an entity type named like an Object.prototype member',
      { p: { entities: { constructor: 'read' } } },
      "unknown entity type 'constructor'",
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
      'a non-boolean list',
      { p: { entities: { course: { read: '*', list: 'yes' } } } },
      'course.list must be a boolean',
    ],
    [
      'list without fields to read',
      { p: { entities: { course: { list: true } } } },
      'course.list needs fields to read',
    ],
    [
      'list with an empty read list',
      { p: { entities: { course: { read: [], list: true } } } },
      'course.list needs fields to read',
    ],
    [
      'list with a malformed field list, reported instead of thrown',
      { p: { entities: { course: { read: 5, write: 5, list: true } } } },
      "course.read must be '*' or an array of field names",
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

  it('rejects keys under invalid policies at cold start, and keeps full keys working', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { Hono } = await import('hono');
    const app = new Hono();
    app.use(
      apiKeyAuth({
        policies: { reporting: { entities: { lerner: 'read' } } },
        entityConfig,
        apiKeys: '{"full": ["a"], "reporting": ["b"]}',
      }),
    );
    app.get('/', (c) => c.json({ policy: c.get('apiKey').policy }));
    const status = async (key: string) =>
      (await app.request('/', { headers: { 'x-api-key': key } })).status;

    expect(await status('b')).toBe(401);
    expect(await status('a')).toBe(200);
    expect(error).toHaveBeenCalledWith(
      expect.stringMatching(
        /Invalid API key policies; every key under them will be rejected:\n {2}- policy 'reporting'/,
      ),
    );
    error.mockRestore();
  });
});
