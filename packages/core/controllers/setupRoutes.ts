import { Hono } from 'hono';
import { createRouteGuards, requireFullPolicy } from '../middlewares/authorize';
import { entityTypeCheck } from '../middlewares/entity-type-check';
import { mutualTypeCheck } from '../middlewares/mutual-type-check';
import type { DependencyContainer } from '../services/DependencyContainer';

export const setupCommonRoutes = (container: DependencyContainer): Hono => {
  const app = new Hono();
  const guard = createRouteGuards(container.config.EntityConfig);
  /*
   * Mutual endpoint
   */

  app.use(
    '/mutual/:byEntityType/:byEntityId/:entityType',
    mutualTypeCheck(container),
  );
  app.get(
    '/mutual/:byEntityType/:byEntityId/:entityType',
    guard.mutual('read'),
    container.listEntitiesByEntityController.controller,
  );
  app.post(
    '/mutual/:byEntityType/:byEntityId/:entityType/:entityId',
    guard.mutual('create'),
    container.createMutualController.controller,
  );
  app.get(
    '/mutual/:byEntityType/:byEntityId/:entityType/:entityId',
    guard.mutual('read'),
    container.getMutualController.controller,
  );
  app.patch(
    '/mutual/:byEntityType/:byEntityId/:entityType/:entityId',
    guard.mutual('update'),
    container.updateMutualController.controller,
  );
  app.delete(
    '/mutual/:byEntityType/:byEntityId/:entityType/:entityId',
    guard.mutual('delete'),
    container.deleteMutualController.controller,
  );

  /*
   * Entities endpoint
   */

  app.use('/entity/:entityType', entityTypeCheck(container));
  app.get(
    '/entity/:entityType',
    guard.entity('read'),
    container.listEntitiesController.controller,
  );
  app.post(
    '/entity/:entityType',
    guard.entity('create'),
    container.createEntityController.controller,
  );
  app.get(
    '/entity/:entityType/unique/:uniqueField/:uniqueFieldValue',
    guard.entity('read'),
    container.getEntityByUniqueFieldController.controller,
  );
  app.post(
    '/entity/:entityType/:entityId/adjust',
    guard.entity('update'),
    container.adjustEntityController.controller,
  );
  app.get(
    '/entity/:entityType/:entityId',
    guard.entity('read'),
    container.getEntityController.controller,
  );
  // Upsert creates or updates depending on whether the entity exists, and
  // checking which before the write would race, so it needs both.
  app.put(
    '/entity/:entityType/:entityId',
    guard.entity('create', 'update'),
    container.upsertEntityController.controller,
  );
  app.patch(
    '/entity/:entityType/:entityId',
    guard.entity('update'),
    container.updateEntityController.controller,
  );
  app.delete(
    '/entity/:entityType/:entityId',
    guard.entity('delete'),
    container.deleteEntityController.controller,
  );

  /*
   * Tag endpoint
   */
  app.get(
    '/tag/:entityType/:tagName',
    guard.entity('read'),
    container.listTagsController.controller,
  );

  /*
   * Transaction endpoint
   */
  app.post(
    '/transaction',
    guard.transaction(),
    container.executeTransactionController.controller,
  );

  /*
   * WebSocket ticket endpoint. A ticket's feed streams unmasked data, so only
   * `full` keys can get one until WebSocket is scoped.
   */
  app.post(
    '/ws/ticket/:entityType/:entityId',
    requireFullPolicy(),
    container.createTicketController.controller,
  );

  return app;
};
