import type { Entity } from '@monorise/base';
import type { Request, Response } from 'express';
import httpStatus from 'http-status';
import { z } from 'zod';
import type { Mutual, MutualRepository } from '../../data/Mutual';

export class ListEntitiesByEntityController {
  constructor(private associateRepository: MutualRepository) {}

  controller: (req: Request, res: Response) => void = async (req, res) => {
    const { byEntityType, byEntityId, entityType } = req.params as unknown as {
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
    });
    const queryParam = querySchema.parse(req.query);
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

        return res.json({
          entities: items,
        });
      } catch (err) {
        return res.status(httpStatus.BAD_REQUEST).json({
          code: 'INVALID_CHAIN_QUERY',
          message:
            'Chain query is invalid. Please double check the chainEntityQuery param',
        });
      }
    } else {
      const resp = await this.associateRepository.listEntitiesByEntity(
        byEntityType,
        byEntityId,
        entityType,
      );

      return res.json({
        entities: resp.items,
      });
    }
  };
}
