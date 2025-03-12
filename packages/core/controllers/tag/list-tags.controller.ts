import type { Entity } from '@monorise/base';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { TagRepository } from '#/data/Tag';
import { fromLastKeyQuery } from '#/helpers/fromLastKeyQuery';
import { toLastKeyResponse } from '#/helpers/toLastKeyResponse';

const querySchema = z.object({
  group: z.string().optional(),
  query: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  limit: z.string().optional(),
  lastKey: z.string().optional(),
});

export class ListTagsController {
  constructor(private tagRepository: TagRepository) {}

  controller: (req: Request, res: Response) => void = async (req, res) => {
    const errorContext: Record<string, unknown> = {};
    try {
      errorContext.params = req.params;
      errorContext.query = req.query;

      const { entityType, tagName } = req.params as unknown as {
        entityType: Entity;
        tagName: string;
      };

      const { lastKey, query, limit, start, end, group } = querySchema.parse(
        req.query,
      );

      const results = await this.tagRepository.listTags({
        entityType,
        tagName,
        limit: Number(limit),
        options: {
          lastKey: fromLastKeyQuery(lastKey),
        },
        query,
        group,
        start,
        end,
      });
      return res.json({
        entities: results.items.map((item) => item.toJSON()),
        totalCount: results.totalCount,
        lastKey: toLastKeyResponse(results.lastKey),
      });
    } catch (error) {
      console.log({ error, errorContext });
      return res.status(500).json({ message: error });
    }
  };
}
