import type {
  SearchConfig,
  SearchMatch,
  SearchSettings,
} from '../types/monorise.type';

export const DEFAULT_MAX_WORDS = 8;

/**
 * @description Words ignored unless an entity or `monorise.config.ts` sets
 * its own list. Deliberately short: an ignored word can never be found on its
 * own, so words that are also names ("an", "will", "may") are left out.
 */
export const DEFAULT_IGNORE_WORDS: readonly string[] = [
  'the',
  'and',
  'of',
  'in',
  'to',
  'for',
  'with',
  'on',
  'at',
  'by',
  'from',
  'or',
  'is',
  'are',
  'was',
  'be',
  'as',
  'it',
  'this',
  'that',
];

// One-letter words are never indexed, and a query needs a longer word to be
// looked up: a one-letter prefix would read a large part of the index.
const MIN_WORD_LENGTH = 2;

const NON_WORD = /[^\p{L}\p{N}]+/u;
const MARKS = /\p{M}/gu;

export type ResolvedSearchConfig = {
  fields: { field: string; match: SearchMatch }[];
  maxWords: number;
  ignoreWords: string[];
};

/**
 * @description Lowercases and strips accents, so "José" and "jose" match.
 */
export function foldText(text: string): string {
  return text.normalize('NFKD').replace(MARKS, '').toLowerCase();
}

/**
 * @description Splits on anything that isn't a letter or digit:
 * "example@mail.com" becomes ["example", "mail", "com"].
 */
export function splitWords(text: string): string[] {
  return foldText(text).split(NON_WORD).filter(Boolean);
}

const collapseSpaces = (text: string) => text.trim().replace(/\s+/g, ' ');

/**
 * @description An entity's `search` config with the `monorise.config.ts`
 * settings and built-in defaults filled in.
 */
export function resolveSearchConfig(
  search: SearchConfig<PropertyKey>,
  defaults?: SearchSettings,
): ResolvedSearchConfig {
  const ignoreWords =
    search.ignoreWords ?? defaults?.ignoreWords ?? DEFAULT_IGNORE_WORDS;

  return {
    fields: search.fields.map(({ field, match }) => ({
      field: String(field),
      match: match ?? 'words',
    })),
    maxWords: search.maxWords ?? defaults?.maxWords ?? DEFAULT_MAX_WORDS,
    ignoreWords: [...new Set(ignoreWords.map(foldText))].sort(),
  };
}

/**
 * @description Throws on settings the index can't use. `where` names the
 * config in the message.
 */
export function validateSearchSettings(
  settings: SearchSettings,
  where: string,
): void {
  const { maxWords, ignoreWords } = settings;
  if (maxWords !== undefined && (!Number.isInteger(maxWords) || maxWords < 1)) {
    throw new Error(`${where}: 'search.maxWords' must be a positive integer.`);
  }
  if (
    ignoreWords !== undefined &&
    (!Array.isArray(ignoreWords) ||
      ignoreWords.some((word) => typeof word !== 'string'))
  ) {
    throw new Error(
      `${where}: 'search.ignoreWords' must be an array of strings.`,
    );
  }
}

/**
 * @description Changes whenever the words an entity is indexed by would.
 * Only used to notice that, so it doesn't need to be cryptographic (cyrb53).
 */
export function searchConfigHash(config: ResolvedSearchConfig): string {
  const input = JSON.stringify(config);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ char, 2654435761);
    h2 = Math.imul(h2 ^ char, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

// Strings and numbers, and the strings and numbers inside an array.
function fieldValues(
  data: Record<string, unknown> | undefined,
  field: string,
): string[] {
  const value = data?.[field];
  const values = Array.isArray(value) ? value : [value];

  return values
    .filter((v) => typeof v === 'string' || typeof v === 'number')
    .map(String);
}

/**
 * @description The words an entity can be found by: fields in config order,
 * without one-letter words, ignored words and duplicates, up to `maxWords`.
 * Writing the index and checking a match both use this, so a word past the
 * cap is never found, whichever word a query is looked up by.
 */
export function indexedWords(
  data: Record<string, unknown> | undefined,
  config: ResolvedSearchConfig,
): string[] {
  const ignore = new Set(config.ignoreWords);
  const words = new Set<string>();

  for (const { field } of config.fields) {
    for (const value of fieldValues(data, field)) {
      for (const word of splitWords(value)) {
        if (word.length < MIN_WORD_LENGTH || ignore.has(word)) continue;
        words.add(word);
        if (words.size === config.maxWords) return [...words];
      }
    }
  }

  return [...words];
}

export type SearchTerm = {
  /** Each must be the start of one of the entity's indexed words. */
  words: string[];
  /** Must also appear as typed in one field: quoted, or joined by symbols. */
  phrase?: string;
};

export type SearchPlan = {
  /** The word whose index rows are read. Without one, nothing matches. */
  anchor?: string;
  terms: SearchTerm[];
};

/**
 * @description Parses a query. Plain words match from the start of a word,
 * in any order. Quoted text and text joined by symbols ("example@mail.com")
 * must also appear exactly. The anchor is the longest word.
 */
export function planSearch(
  query: string,
  ignoreWords: readonly string[],
): SearchPlan {
  const ignore = new Set(ignoreWords);
  const parsed: { text: string; quoted: boolean }[] = [];
  const termPattern = /"([^"]+)"|(\S+)/g;
  for (
    let match = termPattern.exec(query);
    match;
    match = termPattern.exec(query)
  ) {
    parsed.push({ text: match[1] ?? match[2], quoted: match[1] !== undefined });
  }

  const terms: SearchTerm[] = [];
  let trailing: string | undefined;

  parsed.forEach(({ text, quoted }, i) => {
    const parts = splitWords(text);
    const words = parts.filter(
      (word) => word.length >= MIN_WORD_LENGTH && !ignore.has(word),
    );

    if (quoted || parts.length > 1) {
      terms.push({ words, phrase: collapseSpaces(foldText(text)) });
    } else if (words.length) {
      terms.push({ words });
    } else if (
      i === parsed.length - 1 &&
      (parts[0]?.length ?? 0) >= MIN_WORD_LENGTH
    ) {
      // An ignored last word may still be being typed ("and" on the way to
      // "anderson").
      trailing = parts[0];
    }
  });

  const required = terms.flatMap((term) => term.words);
  if (!required.length && trailing) {
    // On its own it's looked up as a prefix. Next to other words it's dropped.
    return { anchor: trailing, terms: [...terms, { words: [trailing] }] };
  }

  const anchor = required.reduce<string | undefined>(
    (longest, word) =>
      !longest || word.length > longest.length ? word : longest,
    undefined,
  );

  return { anchor, terms };
}

/**
 * @description Whether an entity's data matches a planned query.
 */
export function matchesSearch(
  data: Record<string, unknown> | undefined,
  plan: SearchPlan,
  config: ResolvedSearchConfig,
): boolean {
  if (!plan.anchor) return false;

  const words = indexedWords(data, config);
  const values = config.fields.flatMap(({ field }) =>
    fieldValues(data, field).map((value) => collapseSpaces(foldText(value))),
  );

  return plan.terms.every(
    ({ words: termWords, phrase }) =>
      termWords.every((word) => words.some((w) => w.startsWith(word))) &&
      (!phrase || values.some((value) => value.includes(phrase))),
  );
}
