import { setupCommonRoutes } from './controllers/setupRoutes';
import { Entity } from './data/Entity';
import { Mutual } from './data/Mutual';
import { PROJECTION_EXPRESSION } from './data/ProjectionExpression';
import { StandardError } from './errors/standard-error';
import { handler as createEntityProcessor } from './processors/create-entity-processor';
import { handler as mutualProcessor } from './processors/mutual-processor';
import { handler as prejoinProcessor } from './processors/prejoin-processor';
import { handler as replicationProcessor } from './processors/replication-processor';
import { handler as tagProcessor } from './processors/tag-processor';
import { DependencyContainer } from './services/DependencyContainer';

class CoreFactory {
  public setupCommonRoutes: ReturnType<typeof setupCommonRoutes>;
  public mutualProcessor: ReturnType<typeof mutualProcessor>;
  public replicationProcessor: ReturnType<typeof replicationProcessor>;
  public createEntityProcessor: ReturnType<typeof createEntityProcessor>;
  public prejoinProcessor: ReturnType<typeof prejoinProcessor>;
  public tagProcessor: ReturnType<typeof tagProcessor>;
  public dependencyContainer: DependencyContainer;

  constructor(private config: any) {
    const dependencyContainer = new DependencyContainer(this.config);

    this.dependencyContainer = dependencyContainer;
    this.setupCommonRoutes = setupCommonRoutes(dependencyContainer);
    this.mutualProcessor = mutualProcessor(dependencyContainer);
    this.replicationProcessor = replicationProcessor(dependencyContainer);
    this.createEntityProcessor = createEntityProcessor(dependencyContainer);
    this.prejoinProcessor = prejoinProcessor(dependencyContainer);
    this.tagProcessor = tagProcessor(dependencyContainer);
  }
}

export {
  setupCommonRoutes,
  Entity,
  Mutual,
  PROJECTION_EXPRESSION,
  createEntityProcessor,
  mutualProcessor,
  prejoinProcessor,
  replicationProcessor,
  tagProcessor,
  DependencyContainer,
  StandardError,
};

export default CoreFactory;
