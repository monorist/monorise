import type { Entity } from '@monorise/base';
import type { Request, Response } from 'express';
import httpStatus from 'http-status';
import { ZodError } from 'zod';
import { StandardError, StandardErrorCode } from '../../errors/standard-error';
import type { MutualService } from '../../services/mutual.service';

export class UpdateMutualController {
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
      const mutual = await this.mutualService.updateMutual({
        byEntityType,
        byEntityId,
        entityType,
        entityId,
        mutualPayload: req.body,
        accountId,
        options: {
          returnUpdatedValue: true,
        },
      });

      return res.status(httpStatus.OK).json(mutual);
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(httpStatus.BAD_REQUEST).json({
          code: 'API_VALIDATION_ERROR',
          message: 'API validation failed',
          details: err.flatten(),
        });
      }

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
