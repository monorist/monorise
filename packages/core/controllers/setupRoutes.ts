import { Hono } from 'hono';
import { entityTypeCheck } from '../middlewares/entity-type-check';
import { mutualTypeCheck } from '../middlewares/mutual-type-check';
import type { DependencyContainer } from '../services/DependencyContainer';

export const setupCommonRoutes = (container: DependencyContainer): Hono => {
  const app = new Hono();
  /*
   * Mutual endpoint
   */

  app.use(
    '/mutual/:byEntityType/:byEntityId/:entityType',
    mutualTypeCheck(container),
  );
  app.get(
    '/mutual/:byEntityType/:byEntityId/:entityType',
    container.listEntitiesByEntityController.controller,
  );
  app.post(
    '/mutual/:byEntityType/:byEntityId/:entityType/:entityId',
    container.createMutualController.controller,
  );
  app.get(
    '/mutual/:byEntityType/:byEntityId/:entityType/:entityId',
    container.getMutualController.controller,
  );
  app.patch(
    '/mutual/:byEntityType/:byEntityId/:entityType/:entityId',
    container.updateMutualController.controller,
  );
  app.delete(
    '/mutual/:byEntityType/:byEntityId/:entityType/:entityId',
    container.deleteMutualController.controller,
  );

  /*
   * Entities endpoint
   */

  app.use('/entity/:entityType', entityTypeCheck(container));
  app.get('/entity/:entityType', container.listEntitiesController.controller);
  app.post('/entity/:entityType', container.createEntityController.controller);
  app.get(
    '/entity/:entityType/unique/:uniqueField/:uniqueFieldValue',
    container.getEntityByUniqueFieldController.controller,
  );
  app.get(
    '/entity/:entityType/:entityId',
    container.getEntityController.controller,
  );
  app.put(
    '/entity/:entityType/:entityId',
    container.upsertEntityController.controller,
  );
  app.patch(
    '/entity/:entityType/:entityId',
    container.updateEntityController.controller,
  );
  app.delete(
    '/entity/:entityType/:entityId',
    container.deleteEntityController.controller,
  );

  /*
   * Tag endpoint
   */
  app.get('/tag/:entityType/:tagName', container.listTagsController.controller);
  return app;
};
