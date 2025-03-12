import type { Entity } from '@monorise/base';
import type { NextFunction, Request, Response } from 'express';
import httpStatus from 'http-status';
import { AllowedEntityTypes } from '#/lambda-layer/monorise';

export const entityTypeCheck: (
  req: Request,
  res: Response,
  next: NextFunction,
) => void = (req, res, next) => {
  const { entityType } = req.params as unknown as { entityType: Entity };

  if (!AllowedEntityTypes.includes(entityType)) {
    return res.status(httpStatus.NOT_FOUND).json({
      code: 'NOT_FOUND',
    });
  }

  next();
};
