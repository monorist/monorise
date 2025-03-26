import { DynamoDB } from '@aws-sdk/client-dynamodb';
import type { Entity, createEntityConfig } from '@monorise/base';
import { CORE_TABLE } from '../configs/service.config';
import { getDependencies } from '../helpers/dependencies';
import {
  publishEvent,
  type publishEvent as publishEventType,
} from '../helpers/event';

import { DbUtils } from '../data/DbUtils';
import { EntityRepository } from '../data/Entity';
import { EventUtils } from '../data/EventUtils';
import { MutualRepository } from '../data/Mutual';
import { TagRepository } from '../data/Tag';

import { CreateEntityController } from '../controllers/entity/create-entity.controller';
import { DeleteEntityController } from '../controllers/entity/delete-entity.controller';
import { GetEntityController } from '../controllers/entity/get-entity.controller';
import { ListEntitiesController } from '../controllers/entity/list-entities.controller';
import { UpdateEntityController } from '../controllers/entity/update-entity.controller';
import { UpsertEntityController } from '../controllers/entity/upsert-entity.controller';
import { CreateMutualController } from '../controllers/mutual/create-mutual.controller';
import { DeleteMutualController } from '../controllers/mutual/delete-mutual.controller';
import { GetMutualController } from '../controllers/mutual/get-mutual.controller';
import { ListEntitiesByEntityController } from '../controllers/mutual/list-entities-by-entity.controller';
import { UpdateMutualController } from '../controllers/mutual/update-mutual.controller';
import { EntityService } from './entity.service';
import { MutualService } from './mutual.service';

import { ListTagsController } from '../controllers/tag/list-tags.controller';
import { EntityServiceLifeCycle } from './entity-service-lifecycle';

export class DependencyContainer {
  private _instanceCache: Map<string, any>;
  private _publishEvent: typeof publishEventType | null;
  private _tableName: string;

  constructor(
    public EntityConfig: Record<Entity, ReturnType<typeof createEntityConfig>>,
    public AllowedEntityTypes: any[],
    public EmailAuthEnabledEntities: any[],
    public CreateMutualLifeCycle: any,
  ) {
    this._instanceCache = new Map();
    this._publishEvent = null;
    this._tableName = CORE_TABLE;
  }

  createCachedInstance<T extends new (...args: any[]) => any>(
    ClassRef: T,
    ...args: ConstructorParameters<T>
  ): InstanceType<T> {
    const cacheKey = ClassRef.name;

    if (this._instanceCache.has(cacheKey)) {
      return this._instanceCache.get(cacheKey) as InstanceType<T>;
    }

    const instance = new ClassRef(...args);
    this._instanceCache.set(cacheKey, instance);
    return instance;
  }

  get coreTable(): string {
    if (this._tableName) return this._tableName;

    this._tableName = CORE_TABLE;
    return this._tableName;
  }

  get publishEvent(): typeof publishEventType {
    // for non class based function you can still have your own way of constructing
    if (this._publishEvent) return this._publishEvent;

    this._publishEvent = getDependencies().publishEvent;
    return this._publishEvent;
  }

  get dynamodbClient(): DynamoDB {
    return this.createCachedInstance(DynamoDB);
  }

  get dbUtils(): DbUtils {
    return this.createCachedInstance(DbUtils, this.dynamodbClient);
  }

  get eventUtils(): EventUtils {
    return this.createCachedInstance(
      EventUtils,
      this.EntityConfig,
      this.publishEvent,
    );
  }

  get entityRepository(): EntityRepository {
    return this.createCachedInstance(
      EntityRepository,
      this.EntityConfig,
      this.coreTable,
      this.dynamodbClient,
      this.EmailAuthEnabledEntities,
    );
  }

  get mutualRepository(): MutualRepository {
    return this.createCachedInstance(
      MutualRepository,
      this.coreTable,
      this.dynamodbClient,
      this.dbUtils,
    );
  }

  get entityServiceLifeCycle(): EntityServiceLifeCycle {
    return this.createCachedInstance(
      EntityServiceLifeCycle,
      this.EntityConfig,
      this.publishEvent,
      this.eventUtils,
    );
  }

  get entityService(): EntityService {
    return this.createCachedInstance(
      EntityService,
      this.EntityConfig,
      this.EmailAuthEnabledEntities,
      this.entityRepository,
      this.publishEvent,
      this.entityServiceLifeCycle,
    );
  }

  get mutualService(): MutualService {
    return this.createCachedInstance(
      MutualService,
      this.entityRepository,
      this.mutualRepository,
      this.publishEvent,
      this.dbUtils,
      this.entityServiceLifeCycle,
    );
  }

  get tagRepository(): TagRepository {
    return this.createCachedInstance(
      TagRepository,
      this.coreTable,
      this.dynamodbClient,
    );
  }

  get getEntityController(): GetEntityController {
    return this.createCachedInstance(
      GetEntityController,
      this.entityRepository,
    );
  }

  get listEntitiesController(): ListEntitiesController {
    return this.createCachedInstance(
      ListEntitiesController,
      this.entityRepository,
    );
  }

  get createEntityController(): CreateEntityController {
    return this.createCachedInstance(
      CreateEntityController,
      this.entityService,
    );
  }

  get upsertEntityController(): UpsertEntityController {
    return this.createCachedInstance(
      UpsertEntityController,
      this.EntityConfig,
      this.entityRepository,
      this.publishEvent,
    );
  }

  get updateEntityController(): UpdateEntityController {
    return this.createCachedInstance(
      UpdateEntityController,
      this.entityService,
    );
  }

  get deleteEntityController(): DeleteEntityController {
    return this.createCachedInstance(
      DeleteEntityController,
      this.entityService,
    );
  }

  get listEntitiesByEntityController(): ListEntitiesByEntityController {
    return this.createCachedInstance(
      ListEntitiesByEntityController,
      this.mutualRepository,
    );
  }

  get getMutualController(): GetMutualController {
    return this.createCachedInstance(
      GetMutualController,
      this.mutualRepository,
    );
  }

  get createMutualController(): CreateMutualController {
    return this.createCachedInstance(
      CreateMutualController,
      this.mutualService,
      this.createMutualLifeCycle,
    );
  }

  get updateMutualController(): UpdateMutualController {
    return this.createCachedInstance(
      UpdateMutualController,
      this.mutualService,
    );
  }

  get deleteMutualController(): DeleteMutualController {
    return this.createCachedInstance(
      DeleteMutualController,
      this.mutualService,
    );
  }

  get listTagsController(): ListTagsController {
    return this.createCachedInstance(ListTagsController, this.tagRepository);
  }

  get createMutualLifeCycle(): any {
    if (!this.CreateMutualLifeCycle) return null;

    return this.createCachedInstance(
      this.CreateMutualLifeCycle,
      this.publishEvent,
    );
  }
}
