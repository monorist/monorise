import type { Entity } from '@monorise/base';
import type { NextFunction, Request, Response } from 'express';
import httpStatus from 'http-status';
import type { DependencyContainer } from '../services/DependencyContainer';
// import { AllowedEntityTypes } from '#/lambda-layer/monorise';

export const entityTypeCheck =
  (container: DependencyContainer) => (req, res, next) => {
    const { entityType } = req.params as unknown as { entityType: Entity };

    if (!container.AllowedEntityTypes.includes(entityType)) {
      return res.status(httpStatus.NOT_FOUND).json({
        code: 'NOT_FOUND',
      });
    }

    next();
  };
