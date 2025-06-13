import type { Entity, EntitySchemaMap } from '@monorise/base';

type MutualDataWithIndex = {
  index: number;
};

// biome-ignore lint/suspicious/noEmptyInterface: To be extended via declare module
interface MutualDataMapping {}

type MutualData<
  B extends Entity,
  T extends Entity,
> = B extends keyof MutualDataMapping
  ? T extends keyof MutualDataMapping[B]
    ? MutualDataMapping[B][T]
    : Record<string, any> // Fallback for unmatched T
  : Record<string, any>;

type Mutual<B extends Entity = Entity, T extends Entity = Entity> = {
  entityId: string;
  entityType: T;
  byEntityId: string;
  byEntityType: B;
  mutualId: string;
  data: T extends keyof EntitySchemaMap ? EntitySchemaMap[T] : never;
  mutualData: MutualData<B, T> | Record<string, any>;
  createdAt: string;
  updatedAt: string;
  mutualUpdatedAt: string;
};

export type { MutualDataWithIndex, MutualDataMapping, MutualData, Mutual };
