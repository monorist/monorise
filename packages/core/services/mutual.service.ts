import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type {
  EntitySchemaMap,
  Entity as EntityType,
  MutualConfig,
  createEntityConfig,
} from '@monorise/base';
import { ulid } from 'ulid';
import { z } from 'zod';
import type { DbUtils } from '../data/DbUtils';
import { Entity, type EntityRepository } from '../data/Entity';
import { Mutual, type MutualRepository } from '../data/Mutual';
import type { publishEvent as publishEventType } from '../helpers/event';
import { EVENT } from '../types/event';
import type { EntityServiceLifeCycle } from './entity-service-lifecycle';

/**
 * @description Resolves the effective `asEntity`/`ensureEntityStrongConsistentWrite` for a
 * `createMutual` call, given the mutual relationship's declarative config (set once via
 * `createMutualConfig({ asEntity, ensureEntityStrongConsistentWrite })`) and any options passed
 * directly at this call site.
 *
 * Precedence: an explicit call-site `options.asEntity`/`options.ensureEntityStrongConsistentWrite`
 * always overrides the config-level value (nullish-coalescing — a caller that omits
 * `options.asEntity` entirely falls back to the config; a caller that explicitly sets it always
 * wins). This keeps every existing imperative caller that already passes `options.asEntity`
 * completely unaffected by a config also declaring it.
 *
 * `mutualConfig.asEntity` is the full `createEntityConfig(...)` return value (see
 * `MutualConfig.asEntity` in `@monorise/base`) — its `name` field is the entity type identifier
 * (`MonoriseEntityConfig.name: string | T`), not a field literally called `entityType`.
 */
export function resolveAsEntityOptions<A extends EntityType>(
  mutualConfig:
    | Pick<MutualConfig, 'asEntity' | 'ensureEntityStrongConsistentWrite'>
    | undefined,
  callOptions: {
    asEntity?: A;
    ensureEntityStrongConsistentWrite?: boolean;
  } = {},
): { asEntity: A | undefined; ensureEntityStrongConsistentWrite: boolean } {
  const asEntity = (callOptions.asEntity ??
    (mutualConfig?.asEntity?.name as A | undefined)) as A | undefined;

  if (!asEntity) {
    return { asEntity: undefined, ensureEntityStrongConsistentWrite: false };
  }

  // `mutualConfig?.ensureEntityStrongConsistentWrite` only applies when the call site did NOT
  // override `asEntity` itself — it's the consistency setting for the CONFIG's own `asEntity`
  // type. A call site that overrides `asEntity` to a different entity type has no config-level
  // consistency setting for that type to inherit, so it must default to `false` unless it also
  // explicitly sets `ensureEntityStrongConsistentWrite` itself.
  const ensureEntityStrongConsistentWrite =
    callOptions.ensureEntityStrongConsistentWrite ??
    (callOptions.asEntity === undefined
      ? mutualConfig?.ensureEntityStrongConsistentWrite
      : undefined) ??
    false;

  return { asEntity, ensureEntityStrongConsistentWrite };
}

export class MutualService {
  constructor(
    private EntityConfig: Record<
      EntityType,
      ReturnType<typeof createEntityConfig>
    >,
    private entityRepository: EntityRepository,
    private mutualRepository: MutualRepository,
    private publishEvent: typeof publishEventType,
    private ddbUtils: DbUtils,
    private entityServiceLifeCycle: EntityServiceLifeCycle,
  ) {}

  /**
   * @description Resolves the full `MutualConfig` (not just its `mutualDataSchema`) declared on
   * either side's `mutualFields` for a given entity pair — bidirectional, same lookup
   * `getMutualDataSchema` used inline before being generalized into this shared helper. Used both
   * to resolve the data schema and to resolve `asEntity`/`ensureEntityStrongConsistentWrite`.
   *
   * Matches by entity-pair only, not by which specific `fieldKey` a caller meant — safe because
   * `packages/cli/commands/utils/generate.ts`'s `monorise build` step already rejects two
   * DIFFERENT `MutualConfig` object instances declared for the same unordered entity-type pair
   * anywhere in the whole config tree ("Conflicting mutual configs for entity pair..."), so any
   * config that reaches runtime here has at most one distinct config per pair regardless of how
   * many `fieldKey`s reference it. A build that hasn't run `monorise build` (or a hand-assembled
   * `EntityConfig` bypassing it) isn't protected by this — see that check's own comment.
   */
  private getMutualFieldConfig(
    byEntityType: EntityType,
    entityType: EntityType,
  ): MutualConfig | undefined {
    // Check byEntityType → entityType direction first, then reverse
    for (const [from, to] of [
      [byEntityType, entityType],
      [entityType, byEntityType],
    ]) {
      const mutualFields = this.EntityConfig[from]?.mutual?.mutualFields;
      if (!mutualFields) continue;

      for (const config of Object.values(mutualFields)) {
        // Checks the whole `config.mutual` object (not `config.mutual?.mutualDataSchema`, as
        // this used to) because this helper now also needs to resolve `asEntity`/
        // `ensureEntityStrongConsistentWrite`, not just the data schema. This is a safe
        // loosening, not a behavior change in practice: by the time a `MutualConfig` reaches
        // here, `mutualDataSchema` is always populated — either authored directly, or derived
        // from `asEntity.finalSchema` by `createMutualConfig` — so every config this used to
        // match (truthy schema) is still matched, and no additional ones are.
        if (config.entityType === to && config.mutual) {
          return config.mutual;
        }
      }
    }
    return undefined;
  }

  private getMutualDataSchema(byEntityType: EntityType, entityType: EntityType) {
    return this.getMutualFieldConfig(byEntityType, entityType)?.mutualDataSchema;
  }

  createMutual = async <
    B extends EntityType,
    T extends EntityType,
    A extends EntityType,
  >({
    byEntityType,
    byEntityId,
    entityType,
    entityId,
    mutualPayload,
    accountId,
    options = {},
  }: {
    byEntityType: B;
    byEntityId: string;
    entityType: T;
    entityId: string;
    mutualPayload?: Record<string, unknown>;
    accountId?: string | string[];
    options?: {
      asEntity?: A;
      // when this is enabled, creation of entity will be synchrounous,
      // use this when your business flow requires entity to be created first.
      // Else, we can leave this false and let the creation of entity being async and eventually consistent.
      // Costing will be lower when things happened async as we do not require transactional write.
      ensureEntityStrongConsistentWrite?: boolean;
      mutualId?: string;
      // only use for migration purpose, for example when mutual is already created,
      // but when you need this mutual to be created as entity, mutual creation can be skipped
      skipMutualCreation?: boolean;
      createAndUpdateDatetime?: Date;
      ConditionExpression?: string;
      ExpressionAttributeNames?: Record<string, string>;
      ExpressionAttributeValues?: Record<string, AttributeValue>;
    };
  }) => {
    const {
      createAndUpdateDatetime,
      mutualId,
      skipMutualCreation = false,
      ConditionExpression,
      ExpressionAttributeNames,
      ExpressionAttributeValues,
    } = options;

    // Config-level `asEntity`/`ensureEntityStrongConsistentWrite` (declared once via
    // `createMutualConfig({ asEntity, ensureEntityStrongConsistentWrite })`) is the default; an
    // explicit call-site `options.asEntity`/`options.ensureEntityStrongConsistentWrite` always
    // wins — see `resolveAsEntityOptions`.
    const mutualFieldConfig = this.getMutualFieldConfig(byEntityType, entityType);
    const { asEntity, ensureEntityStrongConsistentWrite } = resolveAsEntityOptions(
      mutualFieldConfig,
      options,
    );

    // `mutualFieldConfig.asEntity` here is the CONFIG-declared asEntity target (from
    // `createMutualConfig`), used only to find the storage schema below — NOT the resolved
    // `asEntity` from `resolveAsEntityOptions` above, which may have been overridden by
    // `options.asEntity` to a different entity type with no config of its own to read a schema
    // from. When a call site overrides `asEntity` without also being able to supply its own
    // storage schema, this falls back to the full `mutualDataSchema` below (unchanged, prior
    // behavior) rather than guessing at a schema for an entity type it knows nothing about.
    const asEntityStorageSchema =
      asEntity && mutualFieldConfig?.asEntity?.name === asEntity
        ? (mutualFieldConfig.asEntity.createSchema ??
            mutualFieldConfig.asEntity.baseSchema)
        : undefined;

    const errorContext: Record<string, unknown> = {
      arguments: {
        byEntityType,
        byEntityId,
        entityType,
        entityId,
        mutualPayload,
        options,
      },
    };

    console.log('[MONORISE_DEBUG] createMutual service start:', {
      byEntityType,
      byEntityId,
      entityType,
      entityId,
      mutualPayload,
      options,
    });

    // `asEntityStorageSchema` (createSchema ?? baseSchema), when this is an `asEntity` mutual,
    // deliberately replaces the finalSchema-derived `mutualDataSchema` for what gets PARSED AND
    // STORED here — not just for narrowing an already-full payload after the fact. Parsing
    // against `asEntityStorageSchema` directly both validates (enforces the target entity's own
    // required `createSchema` fields) and strips (drops the target entity's own further
    // `mutualFields` keys, e.g. `courseIds`) in the same step, so `mutual.mutualData` and the
    // synthetic entity's `data` never end up storing values that belong to a DIFFERENT entity's
    // relationships — see `createMutualConfig`'s own comment on why `mutualDataSchema` itself
    // stays as `finalSchema` (still used below via `getMutualFieldConfig`/hook-wiring paths).
    const mutualDataSchema = this.getMutualDataSchema(byEntityType, entityType);
    const schema =
      asEntityStorageSchema ?? mutualDataSchema ?? z.record(z.string(), z.any());
    console.log('[MONORISE_DEBUG] createMutual schema resolved');

    const parsedMutualPayload = schema.parse(mutualPayload);
    console.log('[MONORISE_DEBUG] createMutual payload parsed:', parsedMutualPayload);

    // Parsed a SECOND time, against the fuller `mutualDataSchema`, purely for the async
    // `CREATE_ENTITY` event payload below — never for storage. The narrowing above is right for
    // `new Mutual(...)`/`new Entity(...)`, but wrong for that event: its consumer
    // (`entityService.createEntity`) runs `finalSchema.parse(entityPayload)` and then passes the
    // UNSTRIPPED payload to `afterCreateEntityHook`, which parses it with `effectiveMutualSchema`
    // to wire the synthetic entity's OWN further `mutualFields`. Sending the narrowed value would
    // silently stop that wiring, and would hard-fail `finalSchema.parse` outright whenever the
    // target entity declares a REQUIRED `createMutualSchema` field. The strong-consistent branch
    // below has never had this problem — it hands the raw `mutualPayload` straight to the hook.
    // When `asEntityStorageSchema` is undefined there was no narrowing to undo, so this is the
    // same object; no second parse is performed.
    const eventMutualPayload = asEntityStorageSchema
      ? (mutualDataSchema?.parse(mutualPayload) ?? mutualPayload)
      : parsedMutualPayload;

    console.log('[MONORISE_DEBUG] createMutual fetching entities...');
    const [{ data: byEntityData }, { data: entityData }] = await Promise.all([
      this.entityRepository.getEntity(byEntityType, byEntityId),
      this.entityRepository.getEntity(entityType, entityId),
    ]);
    console.log('[MONORISE_DEBUG] createMutual entities fetched:', {
      hasByEntityData: !!byEntityData,
      hasEntityData: !!entityData,
    });
    errorContext.byEntityData = byEntityData;
    errorContext.entityData = entityData;

    console.log('[MONORISE_DEBUG] createMutual checking mutual exist...');
    await this.mutualRepository.checkMutualExist(
      byEntityType,
      byEntityId,
      entityType,
      entityId,
    );
    console.log('[MONORISE_DEBUG] createMutual mutual does not exist (ok)');

    const currentDatetime = createAndUpdateDatetime || new Date();

    const mutual = new Mutual(
      byEntityType,
      byEntityId,
      byEntityData,
      entityType,
      entityId,
      entityData,
      parsedMutualPayload,
      mutualId || ulid(),
      currentDatetime,
      currentDatetime,
      currentDatetime,
    );
    console.log('[MONORISE_DEBUG] createMutual mutual object created:', {
      mutualId: mutual.mutualId,
    });

    const mutualTransactions = skipMutualCreation
      ? []
      : this.mutualRepository.createMutualTransactItems(mutual, {
          ConditionExpression,
          ExpressionAttributeNames,
          ExpressionAttributeValues,
        });

    const entityTransactions = [];
    let entity: Entity<A> | undefined;

    // NOTE on keeping the synthetic entity in sync after this point: this method only ever
    // CREATES the synthetic entity (here, or via the async CREATE_ENTITY event below). It does
    // NOT need to (and does not) handle propagating a later `updateMutual`/`deleteMutual` to this
    // entity — that already happens via a separate, pre-existing mechanism: DynamoDB Streams
    // replication (`replication-processor.ts`). `createEntityTransactItems(entity, { mutualId:
    // mutual.mainPk })` below sets `R2PK` on the synthetic entity to the mutual's own PK
    // (`MUTUAL#<mutualId>`, see `Mutual.mainPk`), which the `MUTUAL_REPLICATION_INDEX` GSI uses to
    // find it whenever that mutual is later updated (`MODIFY` → new `mutualData`) or deleted
    // (`REMOVE`). This makes the synthetic entity a READ-ONLY projection: never call
    // `updateEntity`/`deleteEntity` on it directly — always update/delete the mutual, and
    // replication keeps the entity in sync automatically (asynchronously, eventually
    // consistent) — see the "asEntity" section of www/docs/concepts/mutuals.md.

    // construct entity transact item only if need to ensure strong consistent write
    if (asEntity && ensureEntityStrongConsistentWrite) {
      entity = new Entity(
        asEntity,
        mutual.mutualId,
        parsedMutualPayload as EntitySchemaMap[A],
        currentDatetime,
        currentDatetime,
      );

      entityTransactions.push(
        ...this.entityRepository.createEntityTransactItems(entity, {
          mutualId: mutual.mainPk,
        }),
      );
    }

    // write to db regardless of options
    const createTransactItems = [...mutualTransactions, ...entityTransactions];
    errorContext.createTransactItems = createTransactItems;

    console.log('[MONORISE_DEBUG] createMutual executing transaction:', {
      transactItemCount: createTransactItems.length,
    });
    await this.ddbUtils.executeTransactWrite({
      TransactItems: createTransactItems,
    });
    console.log('[MONORISE_DEBUG] createMutual transaction succeeded');

    // duplicated behaviour from entityService.createEntity after write success
    if (asEntity && entity && ensureEntityStrongConsistentWrite) {
      await this.entityServiceLifeCycle.afterCreateEntityHook(
        entity,
        mutualPayload,
        accountId,
      );
    }

    // publish an event to create entity if asEntity defined
    // since it's event-driven, it would be the creation of entity
    // would be eventual consistent
    if (asEntity && !ensureEntityStrongConsistentWrite) {
      await this.publishEvent({
        event: EVENT.CORE.CREATE_ENTITY,
        payload: {
          entityType: asEntity,
          entityId: mutual.mutualId,
          // `eventMutualPayload`, not `mutual.mutualData` — the latter is deliberately
          // storage-narrowed (see where it's parsed above) and is the wrong shape for this
          // event's consumer. Keeps this async path's hook wiring identical to the
          // strong-consistent branch directly above, which passes `mutualPayload` to the hook.
          entityPayload: eventMutualPayload,
          accountId,
          options: {
            createAndUpdateDatetime: mutual.createdAt,
            mutualId: mutual.mutualId,
          },
        },
      });
    }

    const eventPayload = {
      byEntityType,
      byEntityId,
      entityType,
      entityId,
      parsedMutualPayload,
      accountId,
      publishedAt: new Date().toISOString(),
    };

    const eventPromises = [
      this.publishEvent({
        event: EVENT.CORE.MUTUAL_CREATED(byEntityType, entityType),
        payload: eventPayload,
      }),
    ];

    await Promise.all(eventPromises);
    console.log('[MONORISE_DEBUG] createMutual service complete');

    return { mutual, eventPayload };
  };

  updateMutual = async <
    B extends EntityType,
    T extends EntityType,
    M extends Record<string, unknown>,
  >({
    byEntityType,
    byEntityId,
    entityType,
    entityId,
    mutualPayload,
    accountId,
    options,
  }: {
    byEntityType: B;
    byEntityId: string;
    entityType: T;
    entityId: string;
    mutualPayload: M;
    accountId?: string | string[];
    options?: {
      maxObjectUpdateLevel?: number;
      returnUpdatedValue?: boolean;
    };
  }) => {
    console.log('[MONORISE_DEBUG] updateMutual service start:', {
      byEntityType,
      byEntityId,
      entityType,
      entityId,
      mutualPayload,
      options,
    });

    // Same `asEntity`-aware narrowing as `createMutual` — an update to an `asEntity` mutual must
    // not re-introduce the target entity's own further `mutualFields` keys into stored
    // `mutualData` any more than the initial create does (see `createMutual`'s own comment).
    const mutualFieldConfig = this.getMutualFieldConfig(byEntityType, entityType);
    const asEntityStorageSchema = mutualFieldConfig?.asEntity
      ? (mutualFieldConfig.asEntity.createSchema ?? mutualFieldConfig.asEntity.baseSchema)
      : undefined;
    const schema =
      asEntityStorageSchema ??
      mutualFieldConfig?.mutualDataSchema ??
      z.record(z.string(), z.any());
    console.log('[MONORISE_DEBUG] updateMutual schema resolved');

    const parsedMutualPayload = schema.parse(mutualPayload);
    console.log('[MONORISE_DEBUG] updateMutual payload parsed:', parsedMutualPayload);

    console.log('[MONORISE_DEBUG] updateMutual calling repository...');
    const mutual = await this.mutualRepository.updateMutual(
      byEntityType,
      byEntityId,
      entityType,
      entityId,
      { mutualData: parsedMutualPayload },
      options,
    );
    console.log('[MONORISE_DEBUG] updateMutual repository result:', {
      hasMutual: !!mutual,
      mutualId: mutual?.mutualId,
    });

    await this.publishEvent({
      event: EVENT.CORE.MUTUAL_UPDATED(byEntityType, entityType),
      payload: {
        byEntityType,
        byEntityId,
        entityType,
        entityId,
        parsedMutualPayload,
        updatedByAccountId: accountId,
      },
    });
    console.log('[MONORISE_DEBUG] updateMutual service complete');

    return mutual;
  };

  deleteMutual = async ({
    byEntityType,
    byEntityId,
    entityType,
    entityId,
    accountId,
  }: {
    byEntityType: EntityType;
    byEntityId: string;
    entityType: EntityType;
    entityId: string;
    accountId?: string | string[];
  }) => {
    const mutual = await this.mutualRepository.deleteMutual(
      byEntityType,
      byEntityId,
      entityType,
      entityId,
    );

    await this.publishEvent({
      event: EVENT.CORE.MUTUAL_UPDATED(byEntityType, entityType),
      payload: {
        byEntityType,
        byEntityId,
        entityType,
        entityId,
        deletedByAccountId: accountId,
      },
    });

    return mutual;
  };
}
