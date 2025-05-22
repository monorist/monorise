import type { Entity } from '@monorise/base';
import type { Request, Response } from 'express';
import httpStatus from 'http-status';
import type { ZodError } from 'zod';
import { StandardError, StandardErrorCode } from '../../errors/standard-error';
import type { EntityService } from '../../services/entity.service';

export class UpdateEntityController {
  constructor(private entityService: EntityService) {}

  controller: (req: Request, res: Response) => void = async (req, res) => {
    const accountId = req.headers['account-id'];
    const { entityType, entityId } = req.params as unknown as {
      entityType: Entity;
      entityId: string;
    };
    const errorContext: any = {
      accountId,
      'req.params': req.params,
      'req.body': req.body,
    };

    try {
      const entity = await this.entityService.updateEntity({
        entityType,
        entityId,
        entityPayload: req.body,
        accountId,
      });
      errorContext.entity = entity;

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
        err.code === StandardErrorCode.ENTITY_NOT_FOUND
      ) {
        return res.status(httpStatus.NOT_FOUND).json({
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

      console.log(
        '====UPDATE_ENTITY_CONTROLLER_ERROR',
        err,
        JSON.stringify({ errorContext }, null, 2),
      );
      throw err;
    }
  };
}
