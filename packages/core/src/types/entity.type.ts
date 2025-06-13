import type { Entity as EntityType } from '@monorise/base';
import type { Mutual } from '../data/Mutual';

export type Tag = {
  group?: string;
  sortValue?: string;
};

type Prejoins = {
  mutualField: string;
  targetEntityType: EntityType;
  entityPaths: {
    skipCache?: boolean;
    entityType: EntityType;
    processor?: (
      items: Mutual<EntityType, EntityType, Record<string, unknown>>[],
      context: Record<string, unknown>,
    ) => {
      items: Mutual<EntityType, EntityType, Record<string, unknown>>[];
      context?: Record<string, unknown>;
    };
  }[];
}[];

export type { Prejoins };
