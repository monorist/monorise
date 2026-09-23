export {
  setupCommonRoutes,
  Entity,
  EntityRepository,
  EntityService,
  Mutual,
  MutualService,
  MutualRepository,
  TagRepository,
  WebSocketRepository,
  PROJECTION_EXPRESSION,
  createEntityProcessor,
  mutualProcessor,
  prejoinProcessor,
  replicationProcessor,
  tagProcessor,
  DependencyContainer,
  StandardError,
  StandardErrorCode,
  wsConnect,
  wsDisconnect,
  wsDefault,
  wsBroadcast,
} from '../../packages/core/index';

import CoreFactory from '../../packages/core';

export default CoreFactory;
