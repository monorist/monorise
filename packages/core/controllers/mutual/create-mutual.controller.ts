import type { Entity as EntityType } from '@monorise/base';
import type { Request, Response } from 'express';
import httpStatus from 'http-status';
import { ZodError } from 'zod';
import { StandardError } from '../../errors/standard-error';
import type { MutualService } from '../../services/mutual.service';

export class CreateMutualController {
  constructor(private mutualService: MutualService) {}

  controller: (req: Request, res: Response) => void = async (req, res) => {
    const accountId = req.headers['account-id'];
    const { byEntityType, byEntityId, entityType, entityId } =
      req.params as unknown as {
        byEntityType: EntityType;
        byEntityId: string;
        entityType: EntityType;
        entityId: string;
      };

    const { asEntity } = req.query;

    try {
      const { mutual, eventPayload } = await this.mutualService.createMutual({
        byEntityType,
        byEntityId,
        entityType,
        entityId,
        mutualPayload: req.body,
        accountId,
        options: {
          asEntity: asEntity as unknown as EntityType,
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

      if (err instanceof StandardError && err.code === 'MUTUAL_EXISTS') {
        return res.status(httpStatus.BAD_REQUEST).json({
          ...err.toJSON(),
        });
      }

      if (err instanceof StandardError && err.code === 'ENTITY_IS_UNDEFINED') {
        return res.status(httpStatus.BAD_REQUEST).json({
          ...err.toJSON(),
        });
      }

      throw err;
    }
  };
}
