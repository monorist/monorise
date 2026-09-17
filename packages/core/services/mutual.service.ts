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
 * @description Resolves the effective `asEntity` for a `createMutual` call, given the mutual
 * relationship's declarative config (set once via `createMutualConfig({ asEntity })`) and any
 * options passed directly at this call site.
 *
 * Precedence: an explicit call-site `options.asEntity` always overrides the config-level value
 * (nullish-coalescing — a caller that omits `options.asEntity` entirely falls back to the config;
 * a caller that explicitly sets it always wins). This keeps every existing imperative caller that
 * already passes `options.asEntity` completely unaffected by a config also declaring it.
 *
 * `mutualConfig.asEntity` is the full `createEntityConfig(...)` return value (see
 * `MutualConfig.asEntity` in `@monorise/base`) — its `name` field is the entity type identifier
 * (`MonoriseEntityConfig.name: string | T`), not a field literally called `entityType`.
 */
export function resolveAsEntity<A extends EntityType>(
  mutualConfig: Pick<MutualConfig, 'asEntity'> | undefined,
  callOptions: { asEntity?: A } = {},
): A | undefined {
  return (callOptions.asEntity ??
    (mutualConfig?.asEntity?.name as A | undefined)) as A | undefined;
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
   * to resolve the data schema and to resolve `asEntity`.
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
        // this used to) because this helper now also needs to resolve `asEntity`, not just the
        // data schema. This is a safe loosening, not a behavior change in practice: by the time
        // a `MutualConfig` reaches here, `mutualDataSchema` is always populated — either
        // authored directly, or derived from `asEntity.finalSchema` by `createMutualConfig` — so
        // every config this used to match (truthy schema) is still matched, and no additional
        // ones are.
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
      // When set (here, or once on the mutual's own `createMutualConfig`), the mutual is also
      // materialized as a real Entity. That entity is always written SYNCHRONOUSLY, in the same
      // DynamoDB transaction as the mutual itself — there is no asynchronous mode. A failure to
      // write the entity therefore rolls the mutual write back too, rather than leaving an edge
      // with no projection behind it.
      asEntity?: A;
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

    // Config-level `asEntity` (declared once via `createMutualConfig({ asEntity })`) is the
    // default; an explicit call-site `options.asEntity` always wins — see `resolveAsEntity`.
    const mutualFieldConfig = this.getMutualFieldConfig(byEntityType, entityType);
    const asEntity = resolveAsEntity(mutualFieldConfig, options);

    // `mutualFieldConfig.asEntity` here is the CONFIG-declared asEntity target (from
    // `createMutualConfig`), used only to find the storage schema below — NOT the resolved
    // `asEntity` from `resolveAsEntity` above, which may have been overridden by
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
    // CREATES the synthetic entity. It does NOT need to (and does not) handle propagating a
    // later `updateMutual`/`deleteMutual` to this
    // entity — that already happens via a separate, pre-existing mechanism: DynamoDB Streams
    // replication (`replication-processor.ts`). `createEntityTransactItems(entity, { mutualId:
    // mutual.mainPk })` below sets `R2PK` on the synthetic entity to the mutual's own PK
    // (`MUTUAL#<mutualId>`, see `Mutual.mainPk`), which the `MUTUAL_REPLICATION_INDEX` GSI uses to
    // find it whenever that mutual is later updated (`MODIFY` → new `mutualData`) or deleted
    // (`REMOVE`). This makes the synthetic entity a READ-ONLY projection: never call
    // `updateEntity`/`deleteEntity` on it directly — always update/delete the mutual, and
    // replication keeps the entity in sync automatically (asynchronously, eventually
    // consistent) — see the "asEntity" section of www/docs/concepts/mutuals.md.

    // The synthetic entity always goes into the SAME transaction as the mutual: either both
    // land or neither does. That is what makes it safe to read the entity straight after
    // `createMutual` resolves, and it is why there is no "the mutual exists but its projection
    // doesn't" state to reconcile later. The price is a `TransactWriteItems` (2x WCU, plus some
    // latency) rather than a plain write.
    if (asEntity) {
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

    // duplicated behaviour from entityService.createEntity after write success.
    // `mutualPayload` (raw, unnarrowed) — NOT `parsedMutualPayload`/`mutual.mutualData`, which
    // are deliberately storage-narrowed above. The hook parses what it's given with
    // `effectiveMutualSchema` to wire the synthetic entity's OWN further `mutualFields`, so the
    // narrowed value would silently drop that wiring.
    if (entity) {
      await this.entityServiceLifeCycle.afterCreateEntityHook(
        entity,
        mutualPayload,
        accountId,
      );
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
