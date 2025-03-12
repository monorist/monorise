import type { Entity } from '@monorise/base';
import type { Request, Response } from 'express';
import httpStatus from 'http-status';
import type { EntityRepository } from '#/data/Entity';

export class GetEntityController {
  constructor(private entityRepository: EntityRepository) {}

  controller: (req: Request, res: Response) => void = async (req, res) => {
    const { entityType, entityId } = req.params as unknown as {
      entityType: Entity;
      entityId: string;
    };

    try {
      const entity = await this.entityRepository.getEntity(
        entityType,
        entityId,
      );

      return res.status(httpStatus.OK).json(entity);
    } catch (err) {
      if ((err as any).code === 'ENTITY_IS_UNDEFINED') {
        return res.status(httpStatus.NOT_FOUND).json({
          code: 'ENTITY_NOT_FOUND',
          message: 'Entity not found',
        });
      }

      throw err;
    }
  };
}
