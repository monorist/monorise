import type { Entity as EntityType, createEntityConfig } from '@monorise/base';
import { setupCommonRoutes } from './controllers/setupRoutes';
import { Entity, EntityRepository } from './data/Entity';
import { Mutual, MutualRepository } from './data/Mutual';
import { PROJECTION_EXPRESSION } from './data/ProjectionExpression';
import { TagRepository } from './data/Tag';
import { StandardError, StandardErrorCode } from './errors/standard-error';
import { appHandler } from './handles/app';
import { handler as createEntityProcessor } from './processors/create-entity-processor';
import { handler as mutualProcessor } from './processors/mutual-processor';
import { handler as prejoinProcessor } from './processors/prejoin-processor';
import { handler as replicationProcessor } from './processors/replication-processor';
import { handler as tagProcessor } from './processors/tag-processor';
import { DependencyContainer } from './services/DependencyContainer';
import { EntityService } from './services/entity.service';
import { MutualService } from './services/mutual.service';

class CoreFactory {
  public setupCommonRoutes: ReturnType<typeof setupCommonRoutes>;
  public mutualProcessor: ReturnType<typeof mutualProcessor>;
  public replicationProcessor: ReturnType<typeof replicationProcessor>;
  public createEntityProcessor: ReturnType<typeof createEntityProcessor>;
  public prejoinProcessor: ReturnType<typeof prejoinProcessor>;
  public tagProcessor: ReturnType<typeof tagProcessor>;
  public appHandler: ReturnType<typeof appHandler>;
  public dependencyContainer: DependencyContainer;

  constructor(
    private config: {
      EntityConfig: Record<EntityType, ReturnType<typeof createEntityConfig>>;
      AllowedEntityTypes: EntityType[];
      EmailAuthEnabledEntities: EntityType[];
    },
  ) {
    const dependencyContainer = new DependencyContainer(this.config);

    this.dependencyContainer = dependencyContainer;
    this.setupCommonRoutes = setupCommonRoutes(dependencyContainer);
    this.mutualProcessor = mutualProcessor(dependencyContainer);
    this.replicationProcessor = replicationProcessor(dependencyContainer);
    this.createEntityProcessor = createEntityProcessor(dependencyContainer);
    this.prejoinProcessor = prejoinProcessor(dependencyContainer);
    this.tagProcessor = tagProcessor(dependencyContainer);
    this.appHandler = appHandler(dependencyContainer);
  }
}

export {
  setupCommonRoutes,
  Entity,
  EntityRepository,
  EntityService,
  Mutual,
  MutualService,
  MutualRepository,
  TagRepository,
  PROJECTION_EXPRESSION,
  createEntityProcessor,
  mutualProcessor,
  prejoinProcessor,
  replicationProcessor,
  tagProcessor,
  appHandler,
  DependencyContainer,
  StandardError,
  StandardErrorCode,
};

export default CoreFactory;
