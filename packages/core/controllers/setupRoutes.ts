import { Hono } from 'hono';
import {
  requireEntity,
  requireFullPolicy,
  requireMutualTypes,
  requireTransactionOperations,
} from '../middlewares/authorize';
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
    requireMutualTypes(),
    container.listEntitiesByEntityController.controller,
  );
  app.post(
    '/mutual/:byEntityType/:byEntityId/:entityType/:entityId',
    requireMutualTypes(),
    container.createMutualController.controller,
  );
  app.get(
    '/mutual/:byEntityType/:byEntityId/:entityType/:entityId',
    requireMutualTypes(),
    container.getMutualController.controller,
  );
  app.patch(
    '/mutual/:byEntityType/:byEntityId/:entityType/:entityId',
    requireMutualTypes(),
    container.updateMutualController.controller,
  );
  app.delete(
    '/mutual/:byEntityType/:byEntityId/:entityType/:entityId',
    requireMutualTypes(),
    container.deleteMutualController.controller,
  );

  /*
   * Entities endpoint
   */

  app.use('/entity/:entityType', entityTypeCheck(container));
  app.get(
    '/entity/:entityType',
    requireEntity('read'),
    container.listEntitiesController.controller,
  );
  app.post(
    '/entity/:entityType',
    requireEntity('create'),
    container.createEntityController.controller,
  );
  app.get(
    '/entity/:entityType/unique/:uniqueField/:uniqueFieldValue',
    requireEntity('read'),
    container.getEntityByUniqueFieldController.controller,
  );
  app.post(
    '/entity/:entityType/:entityId/adjust',
    requireEntity('update'),
    container.adjustEntityController.controller,
  );
  app.get(
    '/entity/:entityType/:entityId',
    requireEntity('read'),
    container.getEntityController.controller,
  );
  // Upsert creates or updates depending on whether the entity exists, and
  // checking which before the write would race, so it needs both.
  app.put(
    '/entity/:entityType/:entityId',
    requireEntity('create', 'update'),
    container.upsertEntityController.controller,
  );
  app.patch(
    '/entity/:entityType/:entityId',
    requireEntity('update'),
    container.updateEntityController.controller,
  );
  app.delete(
    '/entity/:entityType/:entityId',
    requireEntity('delete'),
    container.deleteEntityController.controller,
  );

  /*
   * Tag endpoint
   */
  app.get(
    '/tag/:entityType/:tagName',
    requireEntity('read'),
    container.listTagsController.controller,
  );

  /*
   * Transaction endpoint
   */
  app.post(
    '/transaction',
    requireTransactionOperations(),
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
