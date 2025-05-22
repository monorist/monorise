import type { Entity } from '@monorise/base';
import type { Request, Response } from 'express';
import httpStatus from 'http-status';
import { StandardError, StandardErrorCode } from '../../errors/standard-error';
import type { MutualService } from '../../services/mutual.service';

export class DeleteMutualController {
  constructor(private mutualService: MutualService) {}

  controller: (req: Request, res: Response) => void = async (req, res) => {
    const accountId = req.headers['account-id'];
    const { byEntityType, byEntityId, entityType, entityId } =
      req.params as unknown as {
        byEntityType: Entity;
        byEntityId: string;
        entityType: Entity;
        entityId: string;
      };

    try {
      const mutual = await this.mutualService.deleteMutual({
        byEntityType,
        byEntityId,
        entityType,
        entityId,
        accountId,
      });

      return res.json(mutual);
    } catch (err) {
      if (
        err instanceof StandardError &&
        err.code === StandardErrorCode.MUTUAL_NOT_FOUND
      ) {
        return res.status(httpStatus.BAD_REQUEST).json({
          ...err.toJSON(),
        });
      }

      throw err;
    }
  };
}
