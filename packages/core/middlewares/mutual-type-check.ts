import type { Entity } from '@monorise/base';
import type { NextFunction, Request, Response } from 'express';
import httpStatus from 'http-status';
import { AllowedEntityTypes } from '#/lambda-layer/monorise';

export const mutualTypeCheck: (
  req: Request,
  res: Response,
  next: NextFunction,
) => void = (req, res, next) => {
  const { entityType, byEntityType } = req.params as unknown as {
    entityType: Entity;
    byEntityType: Entity;
  };

  if (
    !AllowedEntityTypes.includes(entityType) ||
    !AllowedEntityTypes.includes(byEntityType)
  ) {
    return res.status(httpStatus.NOT_FOUND).json({
      code: 'NOT_FOUND',
    });
  }

  next();
};
