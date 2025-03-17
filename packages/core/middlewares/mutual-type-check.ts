import type { Entity } from '@monorise/base';
import type { NextFunction, Request, Response } from 'express';
import httpStatus from 'http-status';
import type { DependencyContainer } from '../services/DependencyContainer';
// import { AllowedEntityTypes } from '#/lambda-layer/monorise';

export const mutualTypeCheck =
  (container: DependencyContainer) => (req, res, next) => {
    const { entityType, byEntityType } = req.params as unknown as {
      entityType: Entity;
      byEntityType: Entity;
    };

    if (
      !container.AllowedEntityTypes.includes(entityType) ||
      !container.AllowedEntityTypes.includes(byEntityType)
    ) {
      return res.status(httpStatus.NOT_FOUND).json({
        code: 'NOT_FOUND',
      });
    }

    next();
  };
