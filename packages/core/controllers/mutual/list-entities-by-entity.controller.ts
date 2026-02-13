import type { Entity } from '@monorise/base';
import { createMiddleware } from 'hono/factory';
import httpStatus from 'http-status';
import { z } from 'zod';
import type { Mutual, MutualRepository } from '../../data/Mutual';

export class ListEntitiesByEntityController {
  constructor(private associateRepository: MutualRepository) {}

  controller = createMiddleware(async (c) => {
    const { byEntityType, byEntityId, entityType } = c.req.param() as {
      byEntityType: Entity;
      byEntityId: string;
      entityType: Entity;
    };

    /**
     * Chain query is a query that allows to query entities by a chain of mutual types.
     * if /core/mutual/learner/:learnerId/pathways?chainEntityQuery=type1,type2
     * then the query will look for list of type1 in learner based on learnerId,
     * then look for list of type2 in type1 by list of entityId of type1,
     * then finally look for list of pathways in type2 by list of entityId of type2.
     */
    const querySchema = z.object({
      chainEntityQuery: z.string().optional(),
      limit: z.coerce.number().optional(),
      lastKey: z.string().optional(),
    });
    const queryParam = querySchema.parse(c.req.query());
    if (queryParam?.chainEntityQuery) {
      try {
        const mutualTypes = queryParam.chainEntityQuery.split(
          ',',
        ) as unknown as Entity[];

        const chainMutualTypes = [byEntityType, ...mutualTypes, entityType];
        let byIds = [byEntityId];
        let items: Mutual<Entity, Entity, Record<string, unknown>>[] = [];

        for (let i = 1; i < chainMutualTypes.length; i++) {
          const byType = chainMutualTypes[i - 1];
          const type = chainMutualTypes[i];
          items = [];

          for (const byId of byIds) {
            const resp = await this.associateRepository.listEntitiesByEntity(
              byType,
              byId,
              type,
            );
            items = items.concat(resp.items);
          }
          byIds = items.map((item) => item.entityId);
        }

        return c.json({
          entities: items,
        });
      } catch (err) {
        throw new Error(
          'Chain query is invalid. Please double check the chainEntityQuery param',
        );
      }
    } else {
      const resp = await this.associateRepository.listEntitiesByEntity(
        byEntityType,
        byEntityId,
        entityType,
        {
          limit: queryParam.limit,
          lastKey: queryParam.lastKey,
        },
      );

      return c.json({
        entities: resp.items,
        lastKey: resp.lastKey,
      });
    }
  });
}
