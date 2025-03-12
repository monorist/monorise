import type { Entity as EntityType } from '@monorise/base';
// import type { z } from 'zod';
// import type { Entity } from '#/data/Entity';
import type { Mutual } from '#/data/Mutual';

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

// type EntityConfig = {
//   authMethod?: {
//     email?: {
//       tokenExpiresIn: number;
//     };
//   };
//   baseSchema: z.ZodType<any>;
//   createSchema?: z.ZodType<any>;
//   searchableFields?: string[];
//   prejoins?: Prejoins;
//   mutual?: {
//     mutualSchema?: z.ZodType<any>;
//     mutualFields?: Record<
//       string,
//       {
//         entityType: EntityType;
//         toMutualIds?: (context: any) => string[];
//         mutualDataProcessor?: (
//           mutualIds: string[],
//           currentMutual: Mutual<any>,
//           customContext?: Record<string, any>,
//         ) => Record<string, any>;
//       }
//     >;
//     subscribes?: { entityType: string }[];
//     prejoins?: Prejoins;
//   };
//   tags?: {
//     name: string;
//     processor: <T extends Record<string, any>>(
//       entity: Entity<T>,
//     ) => Tag[] | Promise<Tag[]>;
//   }[];
// };

export type { Prejoins };
