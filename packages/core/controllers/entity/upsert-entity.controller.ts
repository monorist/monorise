import type { Entity, createEntityConfig } from '@monorise/base';
import { createMiddleware } from 'hono/factory';
import httpStatus from 'http-status';
import { ZodError } from 'zod';
import type { EntityRepository } from '../../data/Entity';
import { StandardError, StandardErrorCode } from '../../errors/standard-error';
import type { publishEvent as publishEventType } from '../../helpers/event';
import { EVENT } from '../../types/event';

export class UpsertEntityController {
  constructor(
    private EntityConfig: Record<Entity, ReturnType<typeof createEntityConfig>>,
    private entityRepository: EntityRepository,
    private publishEvent: typeof publishEventType,
  ) {}

  controller = createMiddleware(async (c) => {
    const accountId = c.req.header('account-id');
    const { entityType, entityId } = c.req.param() as {
      entityType: Entity;
      entityId: string;
    };

    try {
      const entityConfig = this.EntityConfig[entityType];
      const entitySchema = entityConfig.createSchema || entityConfig.baseSchema;
      const mutual = entityConfig.mutual;
      const mutualSchema = mutual?.mutualSchema;

      if (!entitySchema || !mutualSchema) {
        throw new StandardError(
          StandardErrorCode.INVALID_ENTITY_TYPE,
          'Invalid entity type',
        );
      }

      // Upsert has no separate create/update controller of its own — it's
      // one endpoint that inserts or overwrites depending on whether
      // entityId already exists (entityRepository.upsertEntity itself
      // decides this via a conditional update, falling back to create()
      // only on failure). To apply createMutualSchema on the insert case
      // (matching EntityService.createEntity's own behavior), we need to
      // know which case this is BEFORE validating — a plain existence check
      // here, distinct from (and racing with, in principle) the actual
      // upsert below.
      //
      // Only paid for entity types that actually opted into
      // createMutualSchema — upsertEntity itself deliberately avoids this
      // exact read (see its own comment), so every other entity type keeps
      // that single-round-trip behavior unchanged.
      //
      // The race is accepted, but is a little more real than it might look:
      // getEntity is an eventually-consistent read (no ConsistentRead), so a
      // create immediately followed by an upsert within the replication
      // window can read empty, take the strict branch, and 400 a legitimate
      // update. Rarer than a true concurrent-write race, and confining the
      // extra read to opt-in entity types keeps the blast radius small.
      const isCreate = mutual?.createMutualSchema
        ? await this.entityRepository
            .getEntity(entityType, entityId)
            .then(() => false)
            .catch((err) => {
              if (
                err instanceof StandardError &&
                err.code === StandardErrorCode.ENTITY_IS_UNDEFINED
              ) {
                return true;
              }
              throw err;
            })
        : false;

      // Falls back to mutualSchema (already confirmed defined above) if
      // effectiveMutualSchema somehow wasn't computed — it never actually
      // is in practice, since createEntityConfig always derives it from
      // the same mutualSchema this controller already checked.
      const effectiveMutualSchema = isCreate
        ? (entityConfig.effectiveMutualSchema ?? mutualSchema)
        : mutualSchema;

      const body = await c.req.json();

      const parsedEntityPayload = entitySchema.parse(body);
      const parsedMutualPayload = effectiveMutualSchema.parse(body);

      const entity = await this.entityRepository.upsertEntity(
        entityType,
        entityId,
        parsedEntityPayload,
      );

      if (parsedMutualPayload) {
        const byEntityType = entityType;
        const byEntityId = entity.entityId;
        const publishEventPromises = [];

        for (const [fieldKey, config] of Object.entries(
          mutual?.mutualFields || {},
        )) {
          publishEventPromises.push(
            this.publishEvent({
              event: EVENT.CORE.ENTITY_MUTUAL_TO_UPDATE,
              payload: {
                byEntityType,
                byEntityId,
                entityType: config.entityType,
                field: fieldKey,
                mutualIds: (parsedMutualPayload as any)[fieldKey],
                publishedAt: entity.updatedAt || new Date().toISOString(),
              },
            }),
          );
        }
        await Promise.allSettled(publishEventPromises);
      }

      await this.publishEvent({
        event: EVENT.CORE.ENTITY_UPSERTED,
        payload: {
          entityType,
          entityId: entity.entityId,
          payload: body,
          createdByAccountId: accountId,
        },
      });

      return c.json(entity);
    } catch (err) {
      if (err instanceof ZodError) {
        c.status(httpStatus.BAD_REQUEST);
        return c.json({
          code: 'API_VALIDATION_ERROR',
          message: 'API validation failed',
          details: err.flatten(),
        });
      }

      if (
        err instanceof StandardError &&
        err.code === StandardErrorCode.EMAIL_EXISTS
      ) {
        c.status(httpStatus.BAD_REQUEST);
        return c.json({
          ...err.toJSON(),
        });
      }

      throw err;
    }
  });
}
