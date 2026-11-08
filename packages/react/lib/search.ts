import type {
  CreatedEntity,
  Entity,
  MonoriseEntityConfig,
} from '@monorise/base';

// The parts of the store (or an immer draft of it) search results live in.
type SearchState = {
  config: Record<Entity, MonoriseEntityConfig>;
  entity: Record<
    Entity,
    | {
        dataMap: Map<string, CreatedEntity<Entity>>;
        searchResults?: CreatedEntity<Entity>[];
        searchQuery?: string;
      }
    | undefined
  >;
};

// A run of two letters or digits, once accents are removed: the shortest
// word the search index looks a query up by (see `planSearch` in base).
const MARKS = /\p{M}/gu;
const LOOKUP_WORD = /[\p{L}\p{N}]{2,}/u;

/**
 * Whether searching for `query` can return anything. A type that uses
 * `search` needs a word of two or more letters to look up.
 */
export const canSearch = (
  state: SearchState,
  entityType: Entity,
  query: string,
): boolean => {
  if (!query.trim()) return false;
  if (!state.config[entityType]?.search) return true;

  return LOOKUP_WORD.test(query.normalize('NFKD').replace(MARKS, ''));
};

const isNewer = (a: CreatedEntity<Entity>, b: CreatedEntity<Entity>) =>
  new Date(a.updatedAt).getTime() > new Date(b.updatedAt).getTime();

/**
 * Stores a search response as the type's results. The search index is
 * updated from the table's stream, so a result can be older than the copy
 * the client already holds: that newer copy is kept, in the cache and the
 * results.
 */
export const applySearchResults = (
  state: SearchState,
  entityType: Entity,
  query: string,
  results: CreatedEntity<Entity>[],
) => {
  const slice = state.entity[entityType];
  if (!slice) return;

  slice.searchResults = results.map((result) => {
    const cached = slice.dataMap.get(result.entityId);
    if (cached && isNewer(cached, result)) return cached;

    slice.dataMap.set(result.entityId, result);
    return result;
  });
  slice.searchQuery = query;
};

/**
 * Shows an entity's new data where it's already a search result. Which
 * entities match is left to the next search: only the server knows.
 */
export const updateSearchResult = (
  state: SearchState,
  entityType: Entity,
  entity: CreatedEntity<Entity>,
) => {
  const results = state.entity[entityType]?.searchResults;
  if (!results) return;

  const index = results.findIndex((e) => e.entityId === entity.entityId);
  if (index >= 0) results[index] = entity;
};

export const removeFromSearchResults = (
  state: SearchState,
  entityType: Entity,
  entityId: string,
) => {
  const slice = state.entity[entityType];
  if (!slice?.searchResults) return;

  slice.searchResults = slice.searchResults.filter(
    (e) => e.entityId !== entityId,
  );
};
