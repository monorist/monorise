import type { z } from 'zod/v4';

export enum Entity {}

export interface EntitySchemaMap {
  [key: string]: Record<string, any>;
}

export type DraftEntity<T extends Entity = Entity> =
  T extends keyof EntitySchemaMap ? EntitySchemaMap[T] : never;

export type CreatedEntity<T extends Entity = Entity> = {
  entityId: string;
  entityType: string;
  data: T extends keyof EntitySchemaMap ? EntitySchemaMap[T] : never;
  createdAt: string;
  updatedAt: string;
};

/**
 * @description Configuration for a monorise entity, a shared configuration that is used across frontend and backend.
 * This can be served as a single source of truth for the entity configuration.
 * It is used to define the schema, and mutual relationships between this entity and other entities.
 *
 * @example
 * ```ts
 * const baseSchema = z.object({
 *   title: z.string(),
 * }).partial();
 *
 * const createSchema = baseSchema.extend({
 *   title: z.string(),
 * })
 *
 * const config = createEntityConfig({
 *   name: 'learner',
 *   displayName: 'Learner',
 *   baseSchema,
 *   createSchema,
 * });
 * ```
 */
export interface MonoriseEntityConfig<
  T extends Entity = Entity,
  B extends Partial<Record<never, z.core.SomeType>> = Partial<
    Record<never, z.core.SomeType>
  >,
  C extends Partial<Record<never, z.core.SomeType>> = Partial<
    Record<never, z.core.SomeType>
  >,
  M extends Partial<Record<never, z.core.SomeType>> = Partial<
    Record<never, z.core.SomeType>
  >,
  CO extends z.ZodObject<C> | undefined = undefined,
  MO extends z.ZodObject<M> | undefined = undefined,
> {
  /**
   * @description Name of the entity. Must be in **lower-kebab-case** and **unique** across all entities
   *
   * @example `learner`, `learning-activity`
   */
  name: string | T;

  /**
   * @description Display name of the entity. It is not required to be unique
   */
  displayName: string;

  /**
   * @description (DEPRECATED) Use `uniqueFields` instead, Monorise should not handle auth mechanism
   * @description (Optional) Specify the authentication method to be used for the entity
   */
  authMethod?: {
    /**
     * @description Authentication method using email
     *
     * Note: The email used for authentication is unique per entity.
     * For example, if `johndoe@mail.com` is used for `learner` entity,
     * it can be reused again on `admin` entity. However, the same email
     * address cannot be repeated for the same entity.
     */
    email: {
      /**
       * @description Number of milliseconds before the token expires
       */
      tokenExpiresIn: number;
    };
  };

  /**
   * @description Base schema for the entity
   */
  baseSchema: z.ZodObject<B>;

  /**
   * @description Minimal schema required to create an entity
   */
  createSchema?: CO;
  searchableFields?: (keyof B)[];
  uniqueFields?: (keyof B)[];

  /**
   * @description Define mutual relationship of this entity with other entities
   */
  mutual?: {
    /**
     * @description Subscribes to update events from specified entities in the array.
     * These events will be used to run prejoin processor.
     */
    subscribes?: { entityType: Entity }[];
    /**
     * @description Virtual schema for mutual relationship. The schema is only used for validation purpose, but these fields are not stored in the database
     */
    mutualSchema: MO;

    /**
     * @description Keys of `mutualFields` are fields defined in `mutualSchema`.
     * Each field is a mutual relationship between this entity and another entity.
     */
    mutualFields: {
      [key: string]: {
        entityType: Entity;
        toMutualIds?: (context: any) => string[];
        /**
         * @description (Optional) Custom function to process `mutualData`. If not provided, `mutualData` will be empty.
         *
         * @returns the final state of `mutualData` to be stored in the mutual record. Must be an object.
         */
        mutualDataProcessor?: (
          mutualIds: string[],
          currentMutual: any,
          customContext?: Record<string, any>,
        ) => Record<string, any>;
      };
    };

    /**
     * @description (Optional) Better known as tree processor
     * This is used to prejoin entities that are not directly related as mutual.
     * For example, if `learner` entity is related to `course` entity, and `course` entity is related to `module` entity,
     * prejoins can be used to join `learner` and `module` entities.
     * With this, the `learner` entity can access the `module` entity without having to go through the `course` entity,
     * hence reducing the number of queries.
     *
     * DynamoDB best practices: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-general-normalization.html
     *
     */
    prejoins?: {
      mutualField: string;
      targetEntityType: Entity;
      entityPaths: {
        skipCache?: boolean;
        entityType: Entity;
        processor?: (items: any[], context: Record<string, any>) => any;
      }[];
    }[];
  };

  /**
   * @description (Optional) Use tags to create additional access patterns for the entity.
   * Time complexity for retrieving tagged entities is O(1).
   *
   * The following configuration will create a tag named `region` for the `organization` entity grouped by `region`.
   * You would then be able to retrieve all organizations in a specific region by:
   * GET `/core/tag/organization/region?group={region_name}`
   *
   * @example
   *
   * ```ts
   * {
   *   name: 'organization',
   *   tags: [
   *    {
   *      name: 'region',
   *      processor: (entity) => {
   *        return [
   *          {
   *            group: entity.data.region
   *          }
   *        ]
   *      },
   *    }
   *   ]
   * }
   * ```
   *
   * @description
   *
   * The following configuration will create a tag named `dob` for the `user` entity sorted by `dob`.
   * You would then be able to retrieve all users sorted by `dob` by:
   * GET `/core/tag/user/dob?start=2000-01-01&end=2020-12-31`
   *
   * @example
   * ```ts
   * {
   *   name: 'user',
   *   tags: [
   *    {
   *      name: 'dob',
   *      processor: (entity) => {
   *        return [
   *          {
   *            sortValue: entity.data.dob
   *          }
   *        ]
   *      },
   *    }
   *   ]
   * }
   * ```
   */
  tags?: {
    name: string;
    processor: (entity: CreatedEntity<T>) => {
      group?: string;
      sortValue?: string;
    }[];
  }[];
}
