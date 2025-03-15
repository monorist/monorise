import type { Entity } from '@monorise/base';
import type { Request, Response } from 'express';
import httpStatus from 'http-status';
import type { MutualRepository } from '../../data/Mutual';

export class GetMutualController {
  constructor(private associateRepository: MutualRepository) {}

  controller: (req: Request, res: Response) => void = async (req, res) => {
    const { byEntityType, byEntityId, entityType, entityId } =
      req.params as unknown as {
        byEntityType: Entity;
        byEntityId: string;
        entityType: Entity;
        entityId: string;
      };

    try {
      const associate = await this.associateRepository.getMutual(
        byEntityType,
        byEntityId,
        entityType,
        entityId,
      );

      return res.status(httpStatus.OK).json(associate);
    } catch (err) {
      if ((err as any).code === 'MUTUAL_IS_UNDEFINED') {
        return res.status(httpStatus.NOT_FOUND).json({
          code: 'MUTUAL_NOT_FOUND',
          message: 'Mutual not found',
        });
      }

      throw err;
    }
  };
}
