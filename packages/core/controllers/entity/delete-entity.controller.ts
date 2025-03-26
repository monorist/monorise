import type { Entity } from '@monorise/base';
import type { Request, Response } from 'express';
import httpStatus from 'http-status';
import { StandardError } from '../../errors/standard-error';
import type { EntityService } from '../../services/entity.service';

export class DeleteEntityController {
  constructor(private readonly entityService: EntityService) {}

  controller: (req: Request, res: Response) => void = async (req, res) => {
    const accountId = req.headers['account-id'];
    const { entityType, entityId } = req.params as unknown as {
      entityType: Entity;
      entityId: string;
    };

    try {
      await this.entityService.deleteEntity({
        entityType,
        entityId,
        accountId,
      });

      return res.json({ message: 'entity deleted' });
    } catch (err) {
      if (err instanceof StandardError && err.code === 'ENTITY_NOT_FOUND') {
        return res.status(httpStatus.NOT_FOUND).json({
          ...err.toJSON(),
        });
      }

      throw err;
    }
  };
}
