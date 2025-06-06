import type { Entity } from '@monorise/base';
import type { Request, Response } from 'express';
import httpStatus from 'http-status';
import type { ZodError } from 'zod';
import { StandardError, StandardErrorCode } from '../../errors/standard-error';
import type { EntityService } from '../../services/entity.service';

export class CreateEntityController {
  constructor(private entityService: EntityService) {}

  controller: (req: Request, res: Response) => void = async (req, res) => {
    const accountId = req.headers['account-id'];
    const { entityType } = req.params as unknown as {
      entityType: Entity;
    };

    try {
      const entity = await this.entityService.createEntity({
        entityType,
        entityPayload: req.body,
        accountId,
        options: {
          createAndUpdateDatetime: req.body.createdAt,
        },
      });

      return res.status(httpStatus.OK).json(entity);
    } catch (err) {
      if ((err as ZodError).constructor?.name === 'ZodError') {
        return res.status(httpStatus.BAD_REQUEST).json({
          code: 'API_VALIDATION_ERROR',
          message: 'API validation failed',
          details: (err as ZodError).flatten(),
        });
      }

      if (
        err instanceof StandardError &&
        err.code === StandardErrorCode.EMAIL_EXISTS
      ) {
        return res.status(httpStatus.BAD_REQUEST).json({
          ...err.toJSON(),
        });
      }

      if (
        err instanceof StandardError &&
        err.code === StandardErrorCode.UNIQUE_VALUE_EXISTS
      ) {
        return res.status(httpStatus.BAD_REQUEST).json({
          ...err.toJSON(),
        });
      }

      console.log('===create-entity error:', {
        err,
        errorContext: JSON.stringify({ body: req.body, headers: req.headers }),
      });

      throw err;
    }
  };
}
