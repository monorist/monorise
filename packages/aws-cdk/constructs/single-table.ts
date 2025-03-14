import { RemovalPolicy, type Stack } from 'aws-cdk-lib';
import {
  AttributeType,
  ProjectionType,
  StreamViewType,
  Table,
  type TableProps,
} from 'aws-cdk-lib/aws-dynamodb';
import {
  Code,
  type FunctionProps,
  Function as Lambda,
  Runtime,
  StartingPosition,
} from 'aws-cdk-lib/aws-lambda';
import {
  DynamoEventSource,
  SqsDlq,
} from 'aws-cdk-lib/aws-lambda-event-sources';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import {
  ENTITY_REPLICATION_INDEX,
  MUTUAL_REPLICATION_INDEX,
} from '../constants/table.js';

export interface SingleTableProps {
  tableProps?: Partial<TableProps>;
  funcProps?: Partial<FunctionProps>;
}

export class SingleTable extends Construct {
  public readonly id: string;
  public readonly table: Table;
  private readonly dlq: Queue;

  constructor(scope: Stack, id: string, props?: SingleTableProps) {
    super(scope, id);

    this.id = id;
    this.dlq = new Queue(this, `${id}-queue-dlq`);

    this.table = new Table(this, id, {
      partitionKey: { name: 'PK', type: AttributeType.STRING },
      sortKey: { name: 'SK', type: AttributeType.STRING },
      stream: StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: RemovalPolicy.RETAIN,
      timeToLiveAttribute: props?.tableProps?.timeToLiveAttribute,
    });

    this.table.addGlobalSecondaryIndex({
      indexName: ENTITY_REPLICATION_INDEX,
      partitionKey: { name: 'R1PK', type: AttributeType.STRING },
      sortKey: { name: 'R1SK', type: AttributeType.STRING },
      projectionType: ProjectionType.INCLUDE,
      nonKeyAttributes: [
        'PK',
        'SK',
        'R2PK',
        'R2SK',
        'updatedAt',
        'mutualUpdatedAt',
      ],
    });

    this.table.addGlobalSecondaryIndex({
      indexName: MUTUAL_REPLICATION_INDEX,
      partitionKey: { name: 'R2PK', type: AttributeType.STRING },
      sortKey: { name: 'R2SK', type: AttributeType.STRING },
      projectionType: ProjectionType.INCLUDE,
      nonKeyAttributes: [
        'PK',
        'SK',
        'R2PK',
        'R2SK',
        'updatedAt',
        'mutualUpdatedAt',
      ],
    });

    const environment = {
      DDB_TABLE: this.table.tableName,
    };

    const replicatorFunction = new Lambda(this, `${id}-replicator`, {
      functionName: props?.funcProps?.functionName,
      runtime: Runtime.NODEJS_LATEST,
      code: Code.fromAsset('node_modules/@monorise/core/dist/processors'),
      handler: 'replication-processor.handler',
      timeout: props?.funcProps?.timeout || undefined,
      memorySize: props?.funcProps?.memorySize || undefined,
      environment,
    });

    replicatorFunction.addEventSource(
      new DynamoEventSource(this.table, {
        startingPosition: StartingPosition.LATEST,
        retryAttempts: 1,
        reportBatchItemFailures: true,
        onFailure: new SqsDlq(this.dlq),
      }),
    );
  }
}
