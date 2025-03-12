import type { Entity as EntityType } from '@monorise/base';
import type { Request, Response } from 'express';
import httpStatus from 'http-status';
import { ZodError } from 'zod';
import { StandardError } from '#/errors/standard-error';
import type { publishEvent as publishEventType } from '#/helpers/event';
import type { MutualService } from '#/services/mutual.service';
// import { EVENT, type EventDetail } from '#/shared/types/event';
// import { Entity } from '#/lambda-layer/monorise';

export class CreateMutualController {
  constructor(
    private mutualService: MutualService,
    private publishEvent: typeof publishEventType,
  ) {}

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

      /*
       * Add more custom event based on byEntityType and entityType
       */

      // const eventPromises = [];

      // const eventMaps: Record<string, EventDetail> = {
      //   [`${Entity.LEARNER}_${Entity.LEARNING_ACTIVITY}`]:
      //     EVENT.CORE_SERVICE.LEARNER_LEARNING_ACTIVITY_SUBMITTED,
      // };

      // if (eventMaps[`${byEntityType}_${entityType}`]) {
      //   eventPromises.push(
      //     this.publishEvent({
      //       event: eventMaps[`${byEntityType}_${entityType}`],
      //       payload: eventPayload,
      //     }),
      //   );
      // }

      // await Promise.all(eventPromises);

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
