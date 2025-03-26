import type { Entity } from '@monorise/base';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { EntityRepository } from '../../data/Entity';
import { fromLastKeyQuery } from '../../helpers/fromLastKeyQuery';
import { toLastKeyResponse } from '../../helpers/toLastKeyResponse';

const querySchema = z.object({
  limit: z.string().optional(),
  lastKey: z.string().optional(),
  query: z.string().trim().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
});

export class ListEntitiesController {
  constructor(private entityRepository: EntityRepository) {}

  controller: (req: Request, res: Response) => void = async (req, res) => {
    const errorContext: { [key: string]: any } = {};
    try {
      const accountId = req.headers['account-id'] || '';
      if (Array.isArray(accountId)) {
        throw new Error('multiple account-id detected');
      }

      errorContext.accountId = accountId;
      errorContext.params = req.params;
      errorContext.query = req.query;

      const { entityType } = req.params as unknown as {
        entityType: Entity;
      };

      const { lastKey, query, limit, start, end } = querySchema.parse(
        req.query,
      );
      if (query) {
        const results = await this.entityRepository.queryEntities(
          entityType,
          query,
        );

        return res.json({
          data: results.items.map((item) => item.toJSON()),
          totalCount: results.totalCount,
          filteredCount: results.filteredCount,
        });
      }

      const results = await this.entityRepository.listEntities({
        entityType,
        limit: Number(limit),
        options: {
          lastKey: fromLastKeyQuery(lastKey),
        },
        ...(start && end ? { between: { start, end } } : {}),
      });
      return res.json({
        data: results.items.map((item) => item.toJSON()),
        totalCount: results.totalCount,
        lastKey: toLastKeyResponse(results.lastKey),
      });
    } catch (error) {
      console.log({ error, errorContext });
      return res.status(500).json({ message: error });
    }
  };
}
