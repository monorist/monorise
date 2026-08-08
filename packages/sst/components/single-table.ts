import path from 'node:path';
import {
  ENTITY_REPLICATION_INDEX,
  MUTUAL_REPLICATION_INDEX,
} from '../constants/table';

export type BillingMode = 'PAY_PER_REQUEST' | 'PROVISIONED';

export interface CapacityConfig {
  min: number;
  max: number;
  target: number; // Target utilization percentage
}

export type SingleTableArgs = {
  runtime?: sst.aws.FunctionArgs['runtime'];
  logging?: sst.aws.FunctionArgs['logging'];
  configRoot?: string;
  /**
   * Name of an existing DynamoDB table to use instead of creating a new one.
   * The table must already have DynamoDB Streams enabled with NEW_AND_OLD_IMAGES,
   * the GSIs (R1, R2) expected by monorise, and TTL enabled on the `expiresAt`
   * attribute (monorise always uses `expiresAt` as the TTL attribute name).
   */
  fromTableName?: $util.Input<string>;
  /** Billing mode for the DynamoDB table */
  billingMode?: BillingMode;
  /** Read capacity configuration (only for PROVISIONED mode) */
  readCapacity?: CapacityConfig;
  /** Write capacity configuration (only for PROVISIONED mode) */
  writeCapacity?: CapacityConfig;
  /** Transform the underlying DynamoDB table resource */
  transform?: sst.aws.DynamoArgs['transform'];
  /** Transform the replicator function */
  replicatorTransform?: sst.aws.FunctionArgs['transform'];
  /** Replicator function configuration */
  replicatorConfig?: {
    memory?: sst.aws.FunctionArgs['memory'];
    timeout?: sst.aws.FunctionArgs['timeout'];
    concurrency?: sst.aws.FunctionArgs['concurrency'];
    versioning?: sst.aws.FunctionArgs['versioning'];
  };
};

export class SingleTable {
  public readonly id: string;
  public readonly table: sst.aws.Dynamo;
  public readonly dlq: sst.aws.Queue;
  public readonly replicatorFunctionName: string;

  constructor(id: string, args?: SingleTableArgs) {
    this.id = id;
    this.replicatorFunctionName = `${$app.stage}-${$app.name}-${id}-core-replicator`;
    this.dlq = new sst.aws.Queue(`${id}-core-replicator-dlq`);

    // Build transform for billing mode if specified
    const billingTransform = this.buildBillingTransform(args);

    this.table = args?.fromTableName
      ? sst.aws.Dynamo.get(`${id}-core-table`, args.fromTableName)
      : new sst.aws.Dynamo(`${id}-core-table`, {
          fields: {
            PK: 'string',
            SK: 'string',
            R1PK: 'string',
            R1SK: 'string',
            R2PK: 'string',
            R2SK: 'string',
          },
          primaryIndex: { hashKey: 'PK', rangeKey: 'SK' },
          globalIndexes: {
            [ENTITY_REPLICATION_INDEX]: {
              hashKey: 'R1PK',
              rangeKey: 'R1SK',
              projection: [
                'PK',
                'SK',
                'R2PK',
                'R2SK',
                'updatedAt',
                'mutualUpdatedAt',
              ],
            },
            [MUTUAL_REPLICATION_INDEX]: {
              hashKey: 'R2PK',
              rangeKey: 'R2SK',
              projection: [
                'PK',
                'SK',
                'R2PK',
                'R2SK',
                'updatedAt',
                'mutualUpdatedAt',
              ],
            },
          },
          stream: 'new-and-old-images',
          ttl: 'expiresAt',
          transform: args?.transform ?? billingTransform,
        });

    const environment = {
      CORE_TABLE: this.table.name,
    };

    this.table.subscribe(
      `${id}-core-replicator`,
      {
        name: this.replicatorFunctionName,
        handler: path.join(
          args?.configRoot ?? '',
          '.monorise/handle.replicationHandler',
        ),
        timeout: args?.replicatorConfig?.timeout ?? '60 seconds',
        memory: args?.replicatorConfig?.memory ?? '512 MB',
        runtime: args?.runtime,
        logging: args?.logging,
        environment,
        link: [this.table, this.dlq],
        concurrency: args?.replicatorConfig?.concurrency,
        versioning: args?.replicatorConfig?.versioning,
        transform: args?.replicatorTransform,
      },
      {
        transform: {
          eventSourceMapping: {
            startingPosition: 'LATEST',
            bisectBatchOnFunctionError: true,
            maximumRetryAttempts: 1,
            destinationConfig: {
              onFailure: {
                destinationArn: this.dlq.arn,
              },
            },
          },
        },
      },
    );

    // Add auto-scaling if provisioned mode with capacity config.
    // Skip for an externally-provided table (fromTableName) — its capacity is
    // managed wherever it's actually defined, not here.
    if (!args?.fromTableName) {
      this.setupAutoScaling(args);
    }
  }

  private buildBillingTransform(
    args?: SingleTableArgs,
  ): sst.aws.DynamoArgs['transform'] | undefined {
    if (!args?.billingMode || args.billingMode === 'PAY_PER_REQUEST') {
      return undefined;
    }

    return {
      table: (tableArgs) => {
        tableArgs.billingMode = 'PROVISIONED';
        tableArgs.readCapacity = args.readCapacity?.min ?? 5;
        tableArgs.writeCapacity = args.writeCapacity?.min ?? 5;
      },
    };
  }

  private setupAutoScaling(args?: SingleTableArgs): void {
    if (!args?.billingMode || args.billingMode === 'PAY_PER_REQUEST') {
      return;
    }

    // Setup read capacity auto-scaling
    if (args.readCapacity) {
      const readTarget = new aws.appautoscaling.Target(
        `${this.id}-read-autoscaling-target`,
        {
          maxCapacity: args.readCapacity.max,
          minCapacity: args.readCapacity.min,
          resourceId: $interpolate`table/${this.table.name}`,
          scalableDimension: 'dynamodb:table:ReadCapacityUnits',
          serviceNamespace: 'dynamodb',
        },
      );

      new aws.appautoscaling.Policy(
        `${this.id}-read-autoscaling-policy`,
        {
          policyType: 'TargetTrackingScaling',
          resourceId: readTarget.resourceId,
          scalableDimension: readTarget.scalableDimension,
          serviceNamespace: readTarget.serviceNamespace,
          targetTrackingScalingPolicyConfiguration: {
            predefinedMetricSpecification: {
              predefinedMetricType: 'DynamoDBReadCapacityUtilization',
            },
            targetValue: args.readCapacity.target,
          },
        },
      );
    }

    // Setup write capacity auto-scaling
    if (args.writeCapacity) {
      const writeTarget = new aws.appautoscaling.Target(
        `${this.id}-write-autoscaling-target`,
        {
          maxCapacity: args.writeCapacity.max,
          minCapacity: args.writeCapacity.min,
          resourceId: $interpolate`table/${this.table.name}`,
          scalableDimension: 'dynamodb:table:WriteCapacityUnits',
          serviceNamespace: 'dynamodb',
        },
      );

      new aws.appautoscaling.Policy(
        `${this.id}-write-autoscaling-policy`,
        {
          policyType: 'TargetTrackingScaling',
          resourceId: writeTarget.resourceId,
          scalableDimension: writeTarget.scalableDimension,
          serviceNamespace: writeTarget.serviceNamespace,
          targetTrackingScalingPolicyConfiguration: {
            predefinedMetricSpecification: {
              predefinedMetricType: 'DynamoDBWriteCapacityUtilization',
            },
            targetValue: args.writeCapacity.target,
          },
        },
      );
    }
  }
}
