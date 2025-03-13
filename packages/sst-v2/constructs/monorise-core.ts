import { Duration } from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import {
  EventBus,
  type Function as Lambda,
  type Stack,
  Topic,
} from 'sst/constructs';
import { EVENT, SOURCE } from '#/shared/types/event';
import { QFunction } from './q-function';
import { SingleTable } from './single-table';

type MonoriseCoreProps = {
  appName: string;
  tableName: string;
  alarmHandler?: Lambda;
};

export class MonoriseCore extends Construct {
  public readonly id: string;
  public readonly eventBus: EventBus;
  private appName: string;
  private tableName: string;
  private alarmHandler?: Lambda;

  constructor(scope: Stack, id: string, props: MonoriseCoreProps) {
    super(scope, id);

    this.id = id;
    this.appName = props.appName;
    this.tableName = props.tableName;
    this.alarmHandler = props.alarmHandler;

    this.eventBus = new EventBus(this, 'monorise-event-bus');
    const coreTable = new SingleTable(scope, this.tableName, {
      funcProps: {
        functionName: `${scope.stage}-${this.appName}-core-replicator`,
        handler: 'services/core/function/replication-processor.handler',
      },
      tableProps: {
        timeToLiveAttribute: 'expiresAt',
      },
    });
    coreTable.table.bind([this.eventBus]);

    let dlqTopic: Topic | undefined;

    if (this.alarmHandler) {
      dlqTopic = new Topic(this, 'dlq-alarm-topic');
      dlqTopic.addSubscribers(this, {
        subscriber: {
          function: this.alarmHandler,
        },
      });
    }

    const environment = {
      CORE_TABLE: coreTable.table.tableName,
    };

    const createEntityProcessor = new QFunction(scope, 'create-entity', {
      functionName: `${scope.stage}-${this.appName}-create-entity-processor`,
      handler:
        'services/core/processors/common/create-entity-processor.handler',
      bind: [coreTable.table, this.eventBus],
      timeout: 30,
      memorySize: '512 MB',
      visibilityTimeout: Duration.seconds(35),
      environment,
    });

    const mutualProcessor = new QFunction(scope, 'mutual', {
      functionName: `${scope.stage}-${this.appName}-core-mutual-processor`,
      handler: 'services/core/processors/mutual-processor.handler',
      bind: [coreTable.table, this.eventBus],
      timeout: 30,
      memorySize: '512 MB',
      visibilityTimeout: Duration.seconds(35),
      environment,
    });

    const prejoinProcessor = new QFunction(scope, 'prejoin', {
      functionName: `${scope.stage}-${this.appName}-core-prejoin-processor`,
      handler: 'services/core/processors/prejoin-processor.handler',
      bind: [coreTable.table, this.eventBus],
      timeout: 30,
      memorySize: '512 MB',
      visibilityTimeout: Duration.seconds(35),
      environment,
    });

    const tagProcessor = new QFunction(scope, 'tag', {
      functionName: `${scope.stage}-${this.appName}-core-tag`,
      handler: 'services/core/processors/tag-processor.handler',
      bind: [coreTable.table, this.eventBus],
      timeout: 30,
      memorySize: '512 MB',
      visibilityTimeout: Duration.seconds(35),
      environment,
    });

    this.eventBus.addRules(scope, {
      createEntityRule: {
        pattern: {
          source: [SOURCE.CORE],
          detailType: [EVENT.CORE.CREATE_ENTITY.DetailType],
        },
        targets: {
          processorQueueTarget: createEntityProcessor.queue,
        },
      },
      mutualProcQueueRule: {
        pattern: {
          source: [SOURCE.CORE],
          detailType: [
            EVENT.CORE.ENTITY_MUTUAL_TO_CREATE.DetailType,
            EVENT.CORE.ENTITY_MUTUAL_TO_UPDATE.DetailType,
          ],
        },
        targets: {
          processorQueueTarget: mutualProcessor.queue,
        },
      },
      prejoinQueueRule: {
        pattern: {
          source: [SOURCE.CORE],
          detailType: [
            EVENT.CORE.ENTITY_MUTUAL_PROCESSED.DetailType,
            EVENT.CORE.PREJOIN_RELATIONSHIP_SYNC.DetailType,
          ],
        },
        targets: {
          processorQueueTarget: prejoinProcessor.queue,
        },
      },
      tagQR: {
        pattern: {
          source: [SOURCE.CORE],
          detailType: [
            EVENT.CORE.ENTITY_CREATED.DetailType,
            EVENT.CORE.ENTITY_UPDATED.DetailType,
          ],
        },
        targets: {
          processorQueueTarget: tagProcessor.queue,
        },
      },
    });
  }
}
