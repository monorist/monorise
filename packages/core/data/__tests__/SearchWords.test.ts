import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  DEFAULT_IGNORE_WORDS,
  createEntityConfig,
  indexedWords,
  matchesSearch,
  planSearch,
  resolveSearchConfig,
  searchConfigHash,
  splitWords,
} from '../../../base';
import type { Entity as EntityType } from '../../../base';

const userSearch = resolveSearchConfig({
  fields: [{ field: 'name' }, { field: 'email' }],
});

const matches = (query: string, data: Record<string, unknown>) =>
  matchesSearch(data, planSearch(query, userSearch.ignoreWords), userSearch);

describe('splitWords', () => {
  it('splits on spaces and symbols, lowercased and without accents', () => {
    expect(splitWords('John Doe')).toEqual(['john', 'doe']);
    expect(splitWords('example@mail.com')).toEqual(['example', 'mail', 'com']);
    expect(splitWords('José Ñúñez')).toEqual(['jose', 'nunez']);
    expect(splitWords('shah-alam_selangor')).toEqual([
      'shah',
      'alam',
      'selangor',
    ]);
  });
});

describe('indexedWords', () => {
  it('takes fields in order, without duplicates, one-letter or ignored words', () => {
    expect(
      indexedWords(
        {
          name: 'The Plumbing Company of Malaysia',
          email: 'hello@plumbingco.com.my',
        },
        userSearch,
      ),
    ).toEqual([
      'plumbing',
      'company',
      'malaysia',
      'hello',
      'plumbingco',
      'com',
      'my',
    ]);
    expect(
      indexedWords({ name: 'Will Smith', email: 'will@x.com' }, userSearch),
    ).toEqual(['will', 'smith', 'com']);
  });

  it('stops at maxWords, filling from the first field', () => {
    const config = resolveSearchConfig({
      fields: [{ field: 'description' }],
      maxWords: 3,
    });
    expect(
      indexedWords(
        { description: 'Monthly subscription refund for customer' },
        config,
      ),
    ).toEqual(['monthly', 'subscription', 'refund']);
  });

  it('indexes the strings and numbers in arrays, and numbers', () => {
    const config = resolveSearchConfig({
      fields: [{ field: 'tags' }, { field: 'postcode' }],
    });
    expect(
      indexedWords(
        { tags: ['Shah Alam', 42, { nested: 'no' }, null], postcode: 40000 },
        config,
      ),
    ).toEqual(['shah', 'alam', '42', '40000']);
  });

  it('ignores missing fields and non-text values', () => {
    expect(indexedWords({ name: true }, userSearch)).toEqual([]);
    expect(indexedWords(undefined, userSearch)).toEqual([]);
  });
});

describe('planSearch and matchesSearch', () => {
  const johnDoe = { name: 'John Doe', email: 'john.doe@mail.com' };
  const doeJohn = { name: 'Doe John', email: 'mail@example.com' };
  const johnnyDoerr = { name: 'Johnny Doerr', email: 'example@mail.com' };

  it('matches plain words from their start, in any order', () => {
    for (const query of ['john doe', 'doe john', 'jo do', 'JOHN']) {
      expect(matches(query, johnDoe)).toBe(true);
      expect(matches(query, doeJohn)).toBe(true);
      expect(matches(query, johnnyDoerr)).toBe(true);
    }
    expect(matches('ohn', johnDoe)).toBe(false);
  });

  it('matches quoted text exactly', () => {
    expect(matches('"john doe"', johnDoe)).toBe(true);
    expect(matches('"john doe"', doeJohn)).toBe(false);
    expect(matches('"doe john"', doeJohn)).toBe(true);
  });

  it('matches text joined by symbols exactly', () => {
    expect(matches('example@mail.com', johnnyDoerr)).toBe(true);
    expect(matches('example@mail.com', doeJohn)).toBe(false);
    expect(matches('john.doe@', johnDoe)).toBe(true);
    expect(planSearch('example@mail.com', []).anchor).toBe('example');
  });

  it('anchors on the longest word', () => {
    expect(planSearch('bp plumbing', []).anchor).toBe('plumbing');
  });

  it('drops ignored words, except a last word that may still be typed', () => {
    const company = { name: 'The Plumbing Company of Malaysia' };
    const anderson = { name: 'Anderson Ong' };
    expect(matches('the plumbing', company)).toBe(true);
    expect(matches('plumbing company of', company)).toBe(true);
    expect(matches('and', anderson)).toBe(true);
    expect(matches('ong and', anderson)).toBe(true);
    expect(planSearch('the', DEFAULT_IGNORE_WORDS).anchor).toBe('the');
  });

  it('checks ignored words inside quotes as part of the phrase', () => {
    const config = resolveSearchConfig({
      fields: [{ field: 'name' }],
      ignoreWords: ['an'],
    });
    const plan = planSearch('"an nguyen"', config.ignoreWords);
    expect(matchesSearch({ name: 'An Nguyen' }, plan, config)).toBe(true);
    expect(matchesSearch({ name: 'Nguyen An' }, plan, config)).toBe(false);
  });

  it('never finds a word past maxWords, whichever word is the anchor', () => {
    const config = resolveSearchConfig({
      fields: [{ field: 'text' }],
      maxWords: 2,
    });
    const data = { text: 'refund customer finance' };
    expect(
      matchesSearch(data, planSearch('refund', config.ignoreWords), config),
    ).toBe(true);
    expect(
      matchesSearch(data, planSearch('finance', config.ignoreWords), config),
    ).toBe(false);
    expect(
      matchesSearch(
        data,
        planSearch('refund finance', config.ignoreWords),
        config,
      ),
    ).toBe(false);
  });

  it('has no anchor without a word of two or more letters', () => {
    expect(planSearch('j', []).anchor).toBeUndefined();
    expect(planSearch('  ', []).anchor).toBeUndefined();
    expect(planSearch('- .', []).anchor).toBeUndefined();
    expect(matches('j', johnDoe)).toBe(false);
  });

  it('does not match a phrase across fields', () => {
    expect(matches('"doe john"', johnDoe)).toBe(false);
  });
});

describe('resolveSearchConfig', () => {
  const search = { fields: [{ field: 'name' }] };

  it('falls back to monorise.config.ts settings, then the defaults', () => {
    expect(resolveSearchConfig(search).maxWords).toBe(8);
    expect(resolveSearchConfig(search, { maxWords: 5 }).maxWords).toBe(5);
    expect(
      resolveSearchConfig({ ...search, maxWords: 12 }, { maxWords: 5 })
        .maxWords,
    ).toBe(12);
  });

  it("replaces the global ignore list with the entity's", () => {
    const resolved = resolveSearchConfig(
      { ...search, ignoreWords: ['Sdn', 'bhd', 'sdn'] },
      { ignoreWords: [...DEFAULT_IGNORE_WORDS, 'com'] },
    );
    expect(resolved.ignoreWords).toEqual(['bhd', 'sdn']);
    expect(
      resolveSearchConfig(search, { ignoreWords: [] }).ignoreWords,
    ).toEqual([]);
  });

  it('hashes to the same value until the indexed words would change', () => {
    const hash = searchConfigHash(resolveSearchConfig(search));
    expect(searchConfigHash(resolveSearchConfig(search))).toBe(hash);
    expect(searchConfigHash(resolveSearchConfig(search, { maxWords: 8 }))).toBe(
      hash,
    );
    expect(
      searchConfigHash(resolveSearchConfig(search, { maxWords: 9 })),
    ).not.toBe(hash);
    expect(
      searchConfigHash(resolveSearchConfig({ fields: [{ field: 'email' }] })),
    ).not.toBe(hash);
  });
});

describe('createEntityConfig with search', () => {
  const base = {
    name: 'user' as unknown as EntityType,
    displayName: 'User',
    baseSchema: z.object({ name: z.string() }).partial(),
  };

  it("rejects 'search' together with 'searchableFields'", () => {
    expect(() =>
      createEntityConfig({
        ...base,
        searchableFields: ['name'],
        search: { fields: [{ field: 'name' }] },
      }),
    ).toThrow(/can't both be set/);
  });

  it('rejects settings the index cannot use', () => {
    expect(() =>
      createEntityConfig({ ...base, search: { fields: [] } }),
    ).toThrow(/at least one field/);
    expect(() =>
      createEntityConfig({
        ...base,
        search: { fields: [{ field: 'name' }], maxWords: 0 },
      }),
    ).toThrow(/positive integer/);
    expect(() =>
      createEntityConfig({
        ...base,
        search: { fields: [{ field: 'name', match: 'ngram' as 'words' }] },
      }),
    ).toThrow(/unknown match 'ngram'/);
  });
});
