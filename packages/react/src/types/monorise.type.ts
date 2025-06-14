import type { CreatedEntity, Entity } from '@monorise/base';

export type CommonStore<T> = {
  dataMap: Map<string, T>;
  isFirstFetched: boolean;
  lastKey: string;
  searchResults?: CreatedEntity<Entity>[];
};
