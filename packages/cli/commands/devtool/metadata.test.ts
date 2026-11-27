import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { entityMetadata } from './metadata';

test('entityMetadata describes searchable fields and builds a required create template', () => {
  const metadata = entityMetadata({
    name: 'user',
    displayName: 'User',
    baseSchema: z
      .object({
        displayName: z.string().min(1),
        email: z.string().email(),
        nickname: z.string(),
      })
      .partial(),
    createSchema: z.object({
      displayName: z.string().min(1),
      email: z.string().email(),
    }),
    effectiveMutualSchema: z.object({
      teamIds: z.array(z.string()),
    }),
    mutual: {
      mutualFields: {
        teamIds: {
          entityType: 'team',
          mutual: {
            mutualDataSchema: z.object({
              role: z.enum(['owner', 'member']),
              invitedBy: z.string().optional(),
            }),
          },
        },
      },
    },
    tags: [{ name: 'active' }],
    searchableFields: ['displayName', 'email'],
    uniqueFields: ['email'],
  });

  assert.equal(metadata.name, 'user');
  assert.equal(metadata.displayName, 'User');
  assert.equal(metadata.searchable, true);
  assert.deepEqual(metadata.searchFields, ['displayName', 'email']);
  assert.deepEqual(metadata.uniqueFields, ['email']);
  assert.deepEqual(metadata.tags, ['active']);
  assert.deepEqual(metadata.mutuals, [
    {
      entityType: 'team',
      fields: ['teamIds'],
      dataFields: [
        {
          name: 'role',
          type: '"owner" | "member"',
          required: true,
          relationship: false,
          unique: false,
          example: 'owner',
          timestamp: false,
          values: ['owner', 'member'],
        },
        {
          name: 'invitedBy',
          type: 'string',
          required: false,
          relationship: false,
          unique: false,
          example: 'Example invitedBy',
          timestamp: false,
        },
      ],
      createTemplate: { role: 'owner' },
    },
  ]);
  assert.deepEqual(metadata.createTemplate, {
    displayName: 'Alex Morgan',
    email: 'example@example.com',
    teamIds: [],
  });
  assert.deepEqual(
    metadata.fields.find(({ name }) => name === 'nickname'),
    {
      name: 'nickname',
      type: 'string',
      required: false,
      relationship: false,
      unique: false,
      example: 'Example name',
      timestamp: false,
    },
  );
  assert.deepEqual(
    metadata.fields.map(({ name, required, relationship, unique }) => ({
      name,
      required,
      relationship,
      unique,
    })),
    [
      {
        name: 'displayName',
        required: true,
        relationship: false,
        unique: false,
      },
      { name: 'email', required: true, relationship: false, unique: true },
      {
        name: 'nickname',
        required: false,
        relationship: false,
        unique: false,
      },
      { name: 'teamIds', required: true, relationship: true, unique: false },
    ],
  );
});

test('entityMetadata supports indexed search and enum values', () => {
  const metadata = entityMetadata({
    name: 'order',
    baseSchema: z.object({
      status: z.enum(['draft', 'paid']),
      publishedAt: z.string().datetime().optional(),
      dueDate: z.string().date().optional(),
      format: z.string().optional(),
      organisationName: z.string().optional(),
      firstName: z.string().optional(),
      playerName: z.string().optional(),
      contactPhone: z.string().optional(),
    }),
    search: {
      fields: [{ field: 'status' }],
    },
  });

  assert.equal(metadata.searchable, true);
  assert.deepEqual(metadata.tags, []);
  assert.deepEqual(metadata.mutuals, []);
  assert.deepEqual(metadata.searchFields, ['status']);
  assert.deepEqual(metadata.fields[0].values, ['draft', 'paid']);
  assert.equal(metadata.fields[0].type, '"draft" | "paid"');
  assert.deepEqual(metadata.createTemplate, { status: 'draft' });
  assert.equal(
    metadata.fields.find(({ name }) => name === 'publishedAt')?.timestamp,
    true,
  );
  assert.match(
    String(metadata.fields.find(({ name }) => name === 'publishedAt')?.example),
    /^\d{4}-\d{2}-\d{2}T/,
  );
  assert.equal(
    metadata.fields.find(({ name }) => name === 'dueDate')?.timestamp,
    false,
  );
  assert.match(
    String(metadata.fields.find(({ name }) => name === 'dueDate')?.example),
    /^\d{4}-\d{2}-\d{2}$/,
  );
  assert.equal(
    metadata.fields.find(({ name }) => name === 'format')?.timestamp,
    false,
  );
  assert.equal(
    metadata.fields.find(({ name }) => name === 'organisationName')?.example,
    'Example Organisation',
  );
  assert.equal(
    metadata.fields.find(({ name }) => name === 'firstName')?.example,
    'Alex',
  );
  assert.equal(
    metadata.fields.find(({ name }) => name === 'playerName')?.example,
    'Alex Morgan',
  );
  assert.equal(
    metadata.fields.find(({ name }) => name === 'contactPhone')?.example,
    '+1 202-555-0147',
  );
});
