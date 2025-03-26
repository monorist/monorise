import type { Entity } from '@monorise/base';
import type { NextFunction, Request, Response } from 'express';
import httpStatus from 'http-status';
import type { DependencyContainer } from '../services/DependencyContainer';

export const entityTypeCheck =
  (container: DependencyContainer) =>
  (req: Request, res: Response, next: NextFunction) => {
    const { entityType } = req.params as unknown as { entityType: Entity };

    if (!container.AllowedEntityTypes.includes(entityType)) {
      res.status(httpStatus.NOT_FOUND).json({
        code: 'NOT_FOUND',
      });

      return;
    }

    next();
  };
