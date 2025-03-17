import { setupCommonRoutes } from './controllers/setupRoutes';
import { Entity } from './data/Entity';
import { Mutual } from './data/Mutual';
import { PROJECTION_EXPRESSION } from './data/ProjectionExpression';
import { handler as createEntityProcessor } from './processors/create-entity-processor';
import { handler as mutualProcessor } from './processors/mutual-processor';
// import { handler as prejoinProcessor } from './processors/prejoin-processor';
import { handler as replicationProcessor } from './processors/replication-processor';
import { handler as tagProcessor } from './processors/tag-processor';
import { DependencyContainer } from './services/DependencyContainer';

class CoreFactory {
  public setupCommonRoutes: any;
  public mutualProcessor: any;

  constructor(
    private EntityConfig: any,
    private AllowedEntityTypes: any[],
  ) {
    const dependencyContainer = new DependencyContainer(
      this.EntityConfig,
      this.AllowedEntityTypes,
    );

    this.setupCommonRoutes = setupCommonRoutes(dependencyContainer);
    this.mutualProcessor = mutualProcessor(dependencyContainer);
  }
}

export {
  setupCommonRoutes,
  Entity,
  Mutual,
  PROJECTION_EXPRESSION,
  createEntityProcessor,
  // mutualProcessor,
  // prejoinProcessor,
  replicationProcessor,
  tagProcessor,
  DependencyContainer,
};

export default CoreFactory;
