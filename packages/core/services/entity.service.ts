import type {
  AdjustmentCondition,
  EntitySchemaMap,
  Entity as EntityType,
  UpdateCondition,
  WhereConditions,
  createEntityConfig,
} from '@monorise/base';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { z } from 'zod';
import type { EntityRepository } from '../data/Entity';
import { buildConditionExpression } from '../data/utils/build-condition-expression';
import { StandardError, StandardErrorCode } from '../errors/standard-error';
import type { publishEvent as publishEventType } from '../helpers/event';
import { toPartialUpdateSchema } from '../helpers/update-schema';
import type { EventDetailBody as MutualProcessorEventDetailBody } from '../processors/mutual-processor';
import { EVENT } from '../types/event';
import type { EntityServiceLifeCycle } from './entity-service-lifecycle';
import {
  resolveAdjustmentCondition,
  resolveUpdateCondition,
} from './resolve-condition';

const warnedOnce = new Set<string>();
const deprecationWarnOnce = (key: string, message: string) => {
  if (warnedOnce.has(key)) return;
  warnedOnce.add(key);
  console.warn(message);
};

export class EntityService {
  constructor(
    private EntityConfig: Record<
      EntityType,
      ReturnType<typeof createEntityConfig>
    >,
    private EmailAuthEnabledEntities: EntityType[],
    private entityRepository: EntityRepository,
    private publishEvent: typeof publishEventType,
    private entityServiceLifeCycle: EntityServiceLifeCycle,
  ) {}

  createEntity = async <T extends EntityType>({
    entityType,
    entityId,
    entityPayload,
    accountId,
    options,
  }: {
    entityType: T;
    entityPayload: EntitySchemaMap[T] | Record<string, any>;
    entityId?: string;
    accountId?: string | string[];
    options?: {
      createAndUpdateDatetime?: string;
      mutualId?: string;
    };
  }) => {
    const finalSchema = this.EntityConfig[entityType].finalSchema;
    const entitySchema =
      this.EntityConfig[entityType]?.createSchema ||
      this.EntityConfig[entityType]?.baseSchema ||
      z.object({});
    if (!finalSchema || !entitySchema) {
      throw new StandardError(
        StandardErrorCode.INVALID_ENTITY_TYPE,
        'Invalid entity type',
      );
    }

    finalSchema.parse(entityPayload);

    const parsedEntityPayload = entitySchema.parse(
      entityPayload,
    ) as EntitySchemaMap[T] & { email: string };

    if (this.EmailAuthEnabledEntities.includes(entityType)) {
      await this.entityRepository.getEmailAvailability(
        entityType,
        parsedEntityPayload.email,
      );
    }

    const entity = await this.entityRepository.createEntity(
      entityType,
      parsedEntityPayload,
      entityId,
      {
        ...(options?.mutualId
          ? {
              mutualId: `MUTUAL#${options.mutualId}`,
            }
          : {}),
        createAndUpdateDatetime: options?.createAndUpdateDatetime
          ? new Date(options.createAndUpdateDatetime)
          : new Date(),
      },
    );

    await this.entityServiceLifeCycle.afterCreateEntityHook(
      entity,
      entityPayload,
      accountId,
    );

    return entity;
  };

  adjustEntity = async <T extends EntityType>({
    entityType,
    entityId,
    adjustments,
    accountId,
    condition,
  }: {
    entityType: T;
    entityId: string;
    adjustments: Record<string, number>;
    accountId?: string;
    condition?: string;
  }) => {
    const entityConfig = this.EntityConfig[entityType];
    const adjustmentConditions = entityConfig?.adjustmentConditions as
      | Record<string, AdjustmentCondition>
      | undefined;
    const rawConstraints = entityConfig?.adjustmentConstraints;

    let opts:
      | {
          ConditionExpression: string;
          ExpressionAttributeNames: Record<string, string>;
          ExpressionAttributeValues: Record<string, AttributeValue>;
        }
      | undefined;

    if (adjustmentConditions) {
      // New conditions system — $condition is required
      if (!condition) {
        throw new StandardError(
          StandardErrorCode.INVALID_CONDITION,
          'Entity has adjustmentConditions defined; $condition is required for adjustEntity',
        );
      }
      opts = await resolveAdjustmentCondition({
        conditionName: condition,
        conditions: adjustmentConditions,
        adjustments,
        getEntityData: async () => {
          const entity = await this.entityRepository.getEntity(entityType, entityId);
          return entity?.data ?? {};
        },
      });
    } else if (condition) {
      // Client sent $condition but this entity has no adjustmentConditions —
      // mirrors updateEntity's handling of an unknown condition below.
      throw new StandardError(
        StandardErrorCode.INVALID_CONDITION,
        `Entity '${entityType}' has no adjustmentConditions defined`,
      );
    } else if (rawConstraints) {
      deprecationWarnOnce(
        'adjustmentConstraints',
        '[monorise] adjustmentConstraints is deprecated. Use adjustmentConditions instead.',
      );
      // Legacy adjustmentConstraints — backward compatibility
      let resolvedConstraints = rawConstraints;
      const hasDynamicFields = Object.values(rawConstraints).some(
        (c: any) => c.minField || c.maxField,
      );
      if (hasDynamicFields) {
        const currentEntity = await this.entityRepository.getEntity(entityType, entityId);
        const data = currentEntity?.data ?? {};
        resolvedConstraints = {};
        for (const [field, constraint] of Object.entries(rawConstraints)) {
          const resolved: { min?: number; max?: number } = {};
          if ((constraint as any).min !== undefined) resolved.min = (constraint as any).min;
          if ((constraint as any).max !== undefined) resolved.max = (constraint as any).max;
          if ((constraint as any).minField) resolved.min = data[(constraint as any).minField] ?? 0;
          if ((constraint as any).maxField) resolved.max = data[(constraint as any).maxField] ?? Number.MAX_SAFE_INTEGER;
          resolvedConstraints[field] = resolved;
        }
      }
      opts = this.buildLegacyAdjustCondition(adjustments, resolvedConstraints);
    }

    const entity = await this.entityRepository.adjustEntity(
      entityType,
      entityId,
      adjustments,
      opts,
    );

    await this.publishEvent({
      event: EVENT.CORE.ENTITY_UPDATED,
      payload: {
        entityType,
        entityId,
        data: entity.data,
        updatedByAccountId: accountId,
        publishedAt: entity.updatedAt || new Date().toISOString(),
      },
    });

    return entity;
  };

  updateEntity = async <T extends EntityType>({
    entityType,
    entityId,
    entityPayload,
    accountId,
    condition,
    where,
  }: {
    entityType: T;
    entityId: string;
    entityPayload: Partial<EntitySchemaMap[T]>;
    accountId?: string | string[];
    condition?: string;
    /** @deprecated Use `condition` (named condition) instead of raw `where`. */
    where?: WhereConditions;
  }) => {
    const errorContext: Record<string, unknown> = {};

    try {
      const entitySchema = this.EntityConfig[entityType].baseSchema;
      const mutualSchema = this.EntityConfig[entityType].mutual?.mutualSchema;

      if (!entitySchema) {
        throw new StandardError(
          StandardErrorCode.INVALID_ENTITY_TYPE,
          'Invalid entity type',
        );
      }

      // Both schemas are made partial for the update path — see
      // toPartialUpdateSchema. `entityPayload` is declared `Partial<...>` on
      // this method's own signature, and an update emits a field-level SET
      // expression over exactly the keys sent, so a key the caller omitted is
      // a key this write never touches — not a missing required value.
      //
      // The mutual side matters just as much as the base side: `mutualSchema`
      // is authored to be strict enough for creation (see `createMutualSchema`,
      // which exists precisely so a relationship can be mandatory at create
      // time), and parsing an unrelated patch against it rejected the patch
      // for fields it wasn't touching. The loop below already treats an absent
      // mutual field as "nothing to rewire" (`if (!mutualPayload) continue`);
      // the parse has to let it get that far.
      const parsedEntityPayload = toPartialUpdateSchema(entitySchema).parse(
        entityPayload,
      ) as Partial<EntitySchemaMap[T]>;
      const parsedMutualPayload = mutualSchema
        ? toPartialUpdateSchema(mutualSchema).parse(entityPayload)
        : undefined;
      errorContext.parsedMutualPayload = parsedMutualPayload;

      let opts:
        | {
            ConditionExpression: string;
            ExpressionAttributeNames: Record<string, string>;
            ExpressionAttributeValues: Record<string, AttributeValue>;
          }
        | undefined;

      if (condition) {
        const updateConditions = this.EntityConfig[entityType]?.updateConditions as
          | Record<string, UpdateCondition>
          | undefined;
        if (!updateConditions) {
          throw new StandardError(
            StandardErrorCode.INVALID_CONDITION,
            `Entity '${entityType}' has no updateConditions defined`,
          );
        }
        opts = await resolveUpdateCondition({
          conditionName: condition,
          conditions: updateConditions,
          getEntityData: async () => {
            const entity = await this.entityRepository.getEntity(entityType, entityId);
            return entity?.data ?? {};
          },
        });
      } else if (where && Object.keys(where).length > 0) {
        // Legacy $where — disabled by default. Raw DynamoDB operators must
        // never be client-facing (field probing via 200-vs-409 status codes),
        // so this requires an explicit per-entity opt-in.
        if (!this.EntityConfig[entityType]?.allowLegacyWhere) {
          throw new StandardError(
            StandardErrorCode.INVALID_CONDITION,
            `Entity '${entityType}' has legacy $where disabled by default. Use named conditions via $condition, or set allowLegacyWhere: true to opt in (not recommended — re-exposes condition operators to clients).`,
          );
        }
        deprecationWarnOnce(
          'where',
          '[monorise] $where is deprecated. Use named conditions via $condition instead.',
        );
        opts = buildConditionExpression(where);
      }

      // Deliberately AFTER condition/$where validation. This guard rejects a
      // body with no recognised fields, and the controller strips `$condition`
      // and `$where` out of the payload before it reaches here — so a request
      // carrying ONLY a (possibly invalid) condition arrives with an empty
      // payload. Running the guard first masked the real reason with a generic
      // "no recognised fields", which is how it broke the allowLegacyWhere
      // rejection test. Let the condition report its own error first.
      //
      // Partial parsing removed the only thing that used to reject a body with
      // no recognised keys: for a non-`.partial()` `baseSchema`, `{ statuz:
      // 'X' }` previously failed on the missing required fields, whereas
      // `.parse()` now strips the unknown key and yields `{}`. Without this
      // guard that becomes a silent 200 that writes nothing but still bumps
      // `updatedAt` and publishes `entity-updated` — a typo'd field name would
      // look like a successful write.
      //
      // Both halves are required. A body of only mutual fields parses to an
      // empty BASE payload while still being a legitimate patch (it rewires
      // relationships via the loop below), so emptiness of one side alone must
      // not reject.
      const hasBaseKeys = Object.keys(parsedEntityPayload).length > 0;
      const hasMutualKeys =
        !!parsedMutualPayload &&
        Object.keys(parsedMutualPayload as Record<string, unknown>).length > 0;
      if (!hasBaseKeys && !hasMutualKeys) {
        // A ZodError rather than a StandardError on purpose: this is a
        // validation failure, and every controller already maps ZodError to
        // `400 API_VALIDATION_ERROR`. A StandardError with a new code would
        // fall through those handlers to a 500.
        throw new z.ZodError([
          {
            code: 'custom',
            path: [],
            message:
              'Update payload contains no recognised fields. At least one base or mutual field must be supplied.',
          },
        ]);
      }

      const entity = await this.entityRepository.updateEntity(
        entityType,
        entityId,
        { data: parsedEntityPayload },
        opts,
      );
      errorContext.entity = entity;

      if (parsedMutualPayload) {
        const byEntityType = entityType;
        const byEntityId = entityId;
        const publishEventPromises = [];

        for (const [fieldKey, config] of Object.entries(
          this.EntityConfig[entityType].mutual?.mutualFields || {},
        )) {
          const toMutualIds = config.toMutualIds;
          const mutualPayload = (parsedMutualPayload as Record<string, any>)[
            fieldKey
          ];
          if (!mutualPayload) continue;

          publishEventPromises.push(
            this.publishEvent<MutualProcessorEventDetailBody>({
              event: EVENT.CORE.ENTITY_MUTUAL_TO_UPDATE,
              payload: {
                byEntityType,
                byEntityId,
                entityType: config.entityType,
                field: fieldKey,
                mutualIds: toMutualIds
                  ? toMutualIds(mutualPayload)
                  : mutualPayload,
                customContext: toMutualIds ? mutualPayload : {},
                publishedAt: entity.updatedAt || new Date().toISOString(),
              },
            }),
          );
        }
        await Promise.allSettled(publishEventPromises);
      }

      await this.publishEvent({
        event: EVENT.CORE.ENTITY_UPDATED,
        payload: {
          entityType,
          entityId,
          data: entity.data,
          updatedByAccountId: accountId,
          publishedAt: entity.updatedAt || new Date().toISOString(),
        },
      });

      return entity;
    } catch (error) {
      if (error && typeof error === 'object') {
        (error as Record<string, unknown>).context = errorContext;
      }
      throw error;
    }
  };

  /** @deprecated Converts legacy adjustmentConstraints to condition expression opts. */
  private buildLegacyAdjustCondition(
    adjustments: Record<string, number>,
    constraints: Record<string, { min?: number; max?: number }>,
  ) {
    const conditionParts: string[] = [];
    const names: Record<string, string> = { '#data': 'data' };
    const values: Record<string, unknown> = {};

    for (const [field, constraint] of Object.entries(constraints)) {
      const delta = adjustments[field];
      if (delta === undefined) continue;
      const namePlaceholder = `#where_${field}`;
      names[namePlaceholder] = field;
      const fieldRef = `#data.${namePlaceholder}`;

      if (constraint.min !== undefined && delta < 0) {
        const valKey = `:where_${field}_min_threshold`;
        conditionParts.push(`${fieldRef} >= ${valKey}`);
        values[valKey] = constraint.min - delta;
      }
      if (constraint.max !== undefined && delta > 0) {
        const valKey = `:where_${field}_max_threshold`;
        conditionParts.push(`${fieldRef} <= ${valKey}`);
        values[valKey] = constraint.max - delta;
      }
    }

    if (conditionParts.length === 0) return undefined;

    return {
      ConditionExpression: conditionParts.join(' AND '),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: marshall(values) as Record<string, AttributeValue>,
    };
  }

  deleteEntity = async <T extends EntityType>({
    entityType,
    entityId,
    accountId,
  }: {
    entityType: T;
    entityId: string;
    accountId?: string | string[];
  }) => {
    await this.entityRepository.deleteEntity(entityType, entityId);

    await this.publishEvent({
      event: EVENT.CORE.ENTITY_DELETED,
      payload: {
        entityType,
        entityId,
        deletedByAccountId: accountId,
      },
    });
  };
}
