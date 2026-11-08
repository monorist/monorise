import {
  type CreatedEntity,
  type Entity,
  type MonoriseEntityConfig,
  type SearchSettings,
  matchesSearch,
  planSearch,
  resolveSearchConfig,
} from '@monorise/base';

// The parts of the store (or an immer draft of it) search results live in.
type SearchState = {
  config: Record<Entity, MonoriseEntityConfig>;
  searchDefaults?: SearchSettings;
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

// Checks an entity against a query the way the server does, for types that
// use `search`. Undefined for types on `searchableFields`: their scan isn't
// mirrored on the client.
const matcherFor = (
  state: SearchState,
  entityType: Entity,
  query: string,
): ((entity: CreatedEntity<Entity>) => boolean) | undefined => {
  const search = state.config[entityType]?.search;
  if (!search) return undefined;

  const config = resolveSearchConfig(search, state.searchDefaults);
  const plan = planSearch(query, config.ignoreWords);
  return (entity) =>
    matchesSearch(entity.data as Record<string, unknown>, plan, config);
};

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

  const search = state.config[entityType]?.search;
  if (!search) return true;

  const config = resolveSearchConfig(search, state.searchDefaults);
  return planSearch(query, config.ignoreWords).anchor !== undefined;
};

const isNewer = (a: CreatedEntity<Entity>, b: CreatedEntity<Entity>) =>
  new Date(a.updatedAt).getTime() > new Date(b.updatedAt).getTime();

/**
 * Stores a search response as the type's results. The index is updated from
 * the table's stream, so a result can be older than the entity the client
 * already holds: the newer copy is kept, in the cache and the results, and
 * dropped from the results if it no longer matches.
 */
export const applySearchResults = (
  state: SearchState,
  entityType: Entity,
  query: string,
  results: CreatedEntity<Entity>[],
) => {
  const slice = state.entity[entityType];
  if (!slice) return;

  const matches = matcherFor(state, entityType, query);
  const kept: CreatedEntity<Entity>[] = [];
  for (const result of results) {
    const cached = slice.dataMap.get(result.entityId);
    if (cached && isNewer(cached, result)) {
      if (!matches || matches(cached)) kept.push(cached);
      continue;
    }
    slice.dataMap.set(result.entityId, result);
    kept.push(result);
  }

  slice.searchResults = kept;
  slice.searchQuery = query;
};

/**
 * Keeps the type's search results in step with an entity the client just
 * wrote: added where it now matches, dropped where it no longer does. For
 * types on `searchableFields`, only a result already shown is updated.
 */
export const reconcileSearchResults = (
  state: SearchState,
  entityType: Entity,
  entity: CreatedEntity<Entity>,
) => {
  const slice = state.entity[entityType];
  if (!slice?.searchResults || slice.searchQuery === undefined) return;

  const results = slice.searchResults;
  const index = results.findIndex((e) => e.entityId === entity.entityId);
  const matches = matcherFor(state, entityType, slice.searchQuery);

  if (!matches) {
    if (index >= 0) results[index] = entity;
  } else if (!matches(entity)) {
    if (index >= 0) results.splice(index, 1);
  } else if (index >= 0) {
    results[index] = entity;
  } else {
    // Newest ID first, the order the server returns.
    const before = results.findIndex((e) => e.entityId < entity.entityId);
    results.splice(before === -1 ? results.length : before, 0, entity);
  }
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
