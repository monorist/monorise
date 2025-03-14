import type { Router } from 'express';
import { DependencyContainer } from '#/services/DependencyContainer';
import { entityTypeCheck } from '../middlewares/entity-type-check';
import { mutualTypeCheck } from '../middlewares/mutual-type-check';

const setupCommonRoutes = (router: Router): void => {
  /*
   * Mutual endpoint
   */
  const container = new DependencyContainer();

  router.use('/mutual/:byEntityType/:byEntityId/:entityType', mutualTypeCheck);
  router.get(
    '/mutual/:byEntityType/:byEntityId/:entityType',
    container.listEntitiesByEntityController.controller,
  );
  router.post(
    '/mutual/:byEntityType/:byEntityId/:entityType/:entityId',
    container.createMutualController.controller,
  );
  router.get(
    '/mutual/:byEntityType/:byEntityId/:entityType/:entityId',
    container.getMutualController.controller,
  );
  router.patch(
    '/mutual/:byEntityType/:byEntityId/:entityType/:entityId',
    container.updateMutualController.controller,
  );
  router.delete(
    '/mutual/:byEntityType/:byEntityId/:entityType/:entityId',
    container.deleteMutualController.controller,
  );

  /*
   * Entities endpoint
   */

  router.use('/entity/:entityType', entityTypeCheck);
  router.get(
    '/entity/:entityType',
    container.listEntitiesController.controller,
  );
  router.post(
    '/entity/:entityType',
    container.createEntityController.controller,
  );
  router.get(
    '/entity/:entityType/:entityId',
    container.getEntityController.controller,
  );
  router.put(
    '/entity/:entityType/:entityId',
    container.upsertEntityController.controller,
  );
  router.patch(
    '/entity/:entityType/:entityId',
    container.updateEntityController.controller,
  );
  router.delete(
    '/entity/:entityType/:entityId',
    container.deleteEntityController.controller,
  );

  /*
   * Tag endpoint
   */
  router.get(
    '/tag/:entityType/:tagName',
    container.listTagsController.controller,
  );
};

export { setupCommonRoutes };
