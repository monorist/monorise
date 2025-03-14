import { Duration, type Stack } from 'aws-cdk-lib';
import { EventBus, Rule } from 'aws-cdk-lib/aws-events';
import { SqsQueue } from 'aws-cdk-lib/aws-events-targets';
import { Code, type Function as Lambda, Runtime } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { EVENT, SOURCE } from './event.js';
import { QFunction } from './q-function.js';
import { SingleTable } from './single-table.js';

interface MonoriseCoreProps {
  appName: string;
  tableName: string;
  alarmHandler?: Lambda;
  coreTable?: SingleTable;
  stage: string;
}

export class MonoriseCore extends Construct {
  public readonly id: string;
  public readonly eventBus: EventBus;
  public readonly coreTable: SingleTable;

  constructor(scope: Stack, id: string, props: MonoriseCoreProps) {
    super(scope, id);

    this.id = id;
    this.eventBus = new EventBus(this, 'monorise-event-bus');
    this.coreTable =
      props.coreTable ||
      new SingleTable(scope, props.tableName, {
        funcProps: {
          functionName: `${props.stage}-${props.appName}-core-replicator`,
        },
        tableProps: {
          timeToLiveAttribute: 'expiresAt',
        },
      });

    const environment = {
      CORE_TABLE: this.coreTable.table.tableName,
      CORE_EVENT_BUS: this.eventBus.eventBusName,
    };

    const createEntityProcessor = new QFunction(scope, 'create-entity', {
      functionProps: {
        functionName: `${props.stage}-${props.appName}-create-entity-processor`,
        runtime: Runtime.NODEJS_20_X,
        code: Code.fromAsset('node_modules/@monorise/core/dist/processors'),
        handler: 'create-entity-processor.handler',
        timeout: Duration.seconds(30),
        memorySize: 512,
        environment,
      },
      appName: props.appName,
    });

    const mutualProcessor = new QFunction(scope, 'mutual', {
      functionProps: {
        functionName: `${props.stage}-${props.appName}-core-mutual-processor`,
        runtime: Runtime.NODEJS_20_X,
        code: Code.fromAsset('node_modules/@monorise/core/dist/processors'),
        handler: 'mutual-processor.handler',
        timeout: Duration.seconds(30),
        memorySize: 512,
        environment,
      },
      appName: props.appName,
    });

    const prejoinProcessor = new QFunction(scope, 'prejoin', {
      functionProps: {
        functionName: `${props.stage}-${props.appName}-core-prejoin-processor`,
        runtime: Runtime.NODEJS_20_X,
        code: Code.fromAsset('node_modules/@monorise/core/dist/processors'),
        handler: 'prejoin-processor.handler',
        timeout: Duration.seconds(30),
        memorySize: 512,
        environment,
      },
      appName: props.appName,
    });

    const tagProcessor = new QFunction(scope, 'tag', {
      functionProps: {
        functionName: `${props.stage}-${props.appName}-core-tag`,
        runtime: Runtime.NODEJS_20_X,
        code: Code.fromAsset('node_modules/@monorise/core/dist/processors'),
        handler: 'tag-processor.handler',
        timeout: Duration.seconds(30),
        memorySize: 512,
        environment,
      },
      appName: props.appName,
    });

    new Rule(scope, 'createEntityRule', {
      eventBus: this.eventBus,
      eventPattern: {
        source: [SOURCE.CORE],
        detailType: [EVENT.CORE.CREATE_ENTITY.DetailType],
      },
      targets: [new SqsQueue(createEntityProcessor.queue)],
    });

    new Rule(scope, 'mutualProcQueueRule', {
      eventBus: this.eventBus,
      eventPattern: {
        source: [SOURCE.CORE],
        detailType: [
          EVENT.CORE.ENTITY_MUTUAL_TO_CREATE.DetailType,
          EVENT.CORE.ENTITY_MUTUAL_TO_UPDATE.DetailType,
        ],
      },
      targets: [new SqsQueue(mutualProcessor.queue)],
    });

    new Rule(scope, 'prejoinQueueRule', {
      eventBus: this.eventBus,
      eventPattern: {
        source: [SOURCE.CORE],
        detailType: [
          EVENT.CORE.ENTITY_MUTUAL_PROCESSED.DetailType,
          EVENT.CORE.PREJOIN_RELATIONSHIP_SYNC.DetailType,
        ],
      },
      targets: [new SqsQueue(prejoinProcessor.queue)],
    });

    new Rule(scope, 'tagQR', {
      eventBus: this.eventBus,
      eventPattern: {
        source: [SOURCE.CORE],
        detailType: [
          EVENT.CORE.ENTITY_CREATED.DetailType,
          EVENT.CORE.ENTITY_UPDATED.DetailType,
        ],
      },
      targets: [new SqsQueue(tagProcessor.queue)],
    });
  }
}
