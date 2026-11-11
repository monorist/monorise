import type { DraftEntity, Entity } from './monorise.type';

/**
 * @description An access level used as shorthand.
 * - On a policy, it applies to every entity and every relationship.
 * - On an entity, it grants every field, every tag, listing and, by default,
 *   every relationship from that entity at that level.
 * - On a relationship, it grants every `mutualData` field at that level.
 *
 * `'write'` means read, create, update and delete.
 */
export type ApiKeyAccessLevel = 'none' | 'read' | 'write';

/**
 * @description System fields a create payload may set only when the create
 * list names them: `$entityId` for a caller-chosen `entityId`, `$createdAt`
 * for a backdated `createdAt`.
 */
export type ApiKeySystemField = '$entityId' | '$createdAt';

/** `'*'` for every field, present and future, or an allowlist. */
export type ApiKeyFieldList<F extends string = string> = '*' | F[];

type EntityField<T extends Entity> = Extract<keyof DraftEntity<T>, string>;

/**
 * @description Each entity type's tag names. The CLI augments this from the
 * entity configs, so `tags` in a policy accepts only real tag names.
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmented by the generated config
export interface ApiKeyEntityTags {}

/**
 * @description The `mutualData` field names of each direction whose pair has
 * a mutual config. The CLI augments this from the entity configs, so a
 * relationship grant's field lists accept only real `mutualData` fields.
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmented by the generated config
export interface ApiKeyMutualDataFields {}

// Without generated names, both fall back to any string, as the CLI's
// validation does for a pair with no mutual config.
type TagName<T extends Entity> = T extends keyof ApiKeyEntityTags
  ? Extract<ApiKeyEntityTags[T], string>
  : string;

type MutualDataField<
  A extends Entity,
  B extends Entity,
> = A extends keyof ApiKeyMutualDataFields
  ? B extends keyof ApiKeyMutualDataFields[A]
    ? Extract<ApiKeyMutualDataFields[A][B], string>
    : string
  : string;

/**
 * @description Access to one direction of a relationship, e.g. learner→course
 * (`/mutual/learner/:id/course`). Field lists name `mutualData` fields.
 */
export type ApiKeyMutualGrant<
  A extends Entity = Entity,
  B extends Entity = Entity,
> =
  | ApiKeyAccessLevel
  | {
      read?: ApiKeyFieldList<MutualDataField<A, B>>;
      create?: ApiKeyFieldList<MutualDataField<A, B>>;
      update?: ApiKeyFieldList<MutualDataField<A, B>>;
      /** Same as `create` and `update` with this list. */
      write?: ApiKeyFieldList<MutualDataField<A, B>>;
      delete?: boolean;
    };

/**
 * @description Access to one entity type.
 *
 * A shorthand string is broad: every field, every tag and every relationship
 * from this entity at that level. An object is exact: only what it lists.
 * Any write grant implies read on the same fields.
 */
export type ApiKeyEntityGrant<T extends Entity = Entity> =
  | ApiKeyAccessLevel
  | {
      /** Fields the key can read: get by ID or unique field, and every response's masking. */
      read?: ApiKeyFieldList<EntityField<T>>;
      /**
       * Also list the whole type: `GET /entity/:type`, search and tag
       * queries. Get only needs a reference to a record; listing needs none,
       * so an object grant lists only when it says so.
       */
      list?: boolean;
      /** Must include every field `createSchema` requires. */
      create?: ApiKeyFieldList<EntityField<T> | ApiKeySystemField>;
      update?: ApiKeyFieldList<EntityField<T>>;
      /** Same as `create` and `update` with this list. */
      write?: ApiKeyFieldList<EntityField<T> | ApiKeySystemField>;
      delete?: boolean;
      /** Defaults to every tag when `read` is `'*'`, otherwise to none. */
      tags?: ApiKeyFieldList<TagName<T>>;
      /**
       * Relationships from this entity, keyed by the target entity type. An
       * entry covers one direction only: `[Entity.COURSE]` under learner is
       * learner→course and says nothing about course→learner. `'*'` sets the
       * level for every direction without an entry; it defaults to `'none'`.
       */
      mutuals?: { '*'?: ApiKeyAccessLevel } & {
        [O in Entity]?: ApiKeyMutualGrant<T, O>;
      };
    };

/**
 * @description A policy. The shorthands `'read'` and `'write'` apply to every
 * entity and relationship, and grant no custom routes.
 */
export type ApiKeyPolicy =
  | 'read'
  | 'write'
  | {
      entities?: { '*'?: ApiKeyAccessLevel } & {
        [T in Entity]?: ApiKeyEntityGrant<T>;
      };
      /**
       * Custom route permissions this policy grants: the names custom routes
       * declare with `requires(...)`. A custom route without `requires(...)`
       * is callable only by `full` keys.
       */
      routes?: string[];
    };

/**
 * @description Every custom route permission the project's policies grant.
 * The CLI augments it from the policies, so `requires()` accepts only names
 * some policy grants.
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmented by the generated config
export interface ApiKeyRoutePermissions {}

/** A custom route permission name; any string until the CLI augments `ApiKeyRoutePermissions`. */
export type ApiKeyRoutePermission = keyof ApiKeyRoutePermissions extends never
  ? string
  : Extract<keyof ApiKeyRoutePermissions, string>;

/**
 * @description Policies keyed by name. `API_KEYS` maps these names to keys.
 * `full` is built in and cannot be redefined.
 */
export type ApiKeyPolicies = Record<string, ApiKeyPolicy>;
