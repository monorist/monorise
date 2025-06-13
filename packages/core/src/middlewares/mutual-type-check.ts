import type { Entity } from '@monorise/base';
import type { NextFunction, Request, Response } from 'express';
import httpStatus from 'http-status';
import type { DependencyContainer } from '../services/DependencyContainer';

export const mutualTypeCheck =
  (container: DependencyContainer) =>
  (req: Request, res: Response, next: NextFunction) => {
    const { entityType, byEntityType } = req.params as unknown as {
      entityType: Entity;
      byEntityType: Entity;
    };

    if (
      !container.config.AllowedEntityTypes.includes(entityType) ||
      !container.config.AllowedEntityTypes.includes(byEntityType)
    ) {
      res.status(httpStatus.NOT_FOUND).json({
        code: 'NOT_FOUND',
      });

      return;
    }

    next();
  };
