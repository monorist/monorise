import type { DraftEntity, Entity } from './monorise.type';

/**
 * @description An access level used as shorthand.
 * - On a policy, it applies to every entity and every relationship.
 * - On an entity, it grants every field, every tag and, by default, every
 *   relationship from that entity at that level.
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
 * @description Access to one direction of a relationship, e.g. learner→course
 * (`/mutual/learner/:id/course`). Field lists name `mutualData` fields.
 */
export type ApiKeyMutualGrant =
  | ApiKeyAccessLevel
  | {
      read?: ApiKeyFieldList;
      create?: ApiKeyFieldList;
      update?: ApiKeyFieldList;
      /** Same as `create` and `update` with this list. */
      write?: ApiKeyFieldList;
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
      read?: ApiKeyFieldList<EntityField<T>>;
      /** Must include every field `createSchema` requires. */
      create?: ApiKeyFieldList<EntityField<T> | ApiKeySystemField>;
      update?: ApiKeyFieldList<EntityField<T>>;
      /** Same as `create` and `update` with this list. */
      write?: ApiKeyFieldList<EntityField<T> | ApiKeySystemField>;
      delete?: boolean;
      /** Defaults to every tag when `read` is `'*'`, otherwise to none. */
      tags?: ApiKeyFieldList;
      /**
       * Relationships from this entity, keyed by the target entity type. An
       * entry covers one direction only: `[Entity.COURSE]` under learner is
       * learner→course and says nothing about course→learner. `'*'` sets the
       * level for every direction without an entry; it defaults to `'none'`.
       */
      mutuals?: { '*'?: ApiKeyAccessLevel } & {
        [O in Entity]?: ApiKeyMutualGrant;
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
