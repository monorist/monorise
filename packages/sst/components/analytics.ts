import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

type ManifestColumn = {
  name: string;
  sourceName: string;
  type: 'boolean' | 'double' | 'string' | 'timestamp' | 'json';
};

type ManifestDataset = {
  kind: 'entity' | 'mutual';
  name: string;
  identifier: string;
  idColumn: string;
  endpoints: { entityName: string; column: string; role?: 'source' | 'target' }[];
  currentTable: string;
  historyTable: string;
  columns: ManifestColumn[];
  partition: { granularity: 'day' | 'hour' };
};

type AnalyticsManifest = {
  version: 2;
  datasets: ManifestDataset[];
  unnamedMutuals: string[];
  schemaFingerprint: string;
};

export type SuppliedAnalyticsResources = {
  bucket?: {
    arn: $util.Input<string>;
    name: $util.Input<string>;
    /** Set only when this bucket has no existing notifications and Monorise may manage them. */
    notificationsManaged?: boolean;
  };
  glueDatabase?: { name: $util.Input<string> };
  workgroup?: { name: $util.Input<string> };
};

export type AnalyticsArgs = {
  /** Omit or set false to leave analytics disabled. */
  enabled?: boolean;
  resources?: SuppliedAnalyticsResources;
  fields?: { omit?: string[] };
  partitions?: Record<string, 'day' | 'hour'>;
  /** Required when `fromTableName` is used because DynamoDB does not expose PITR through table metadata. */
  importedTable?: { pointInTimeRecoveryEnabled: true };
  /** Server-to-server API for executing only these named Athena queries. */
  queryApi?: {
    enabled?: boolean;
    queries: Record<string, {
      sql: string;
      parameters?: Record<string, {
        type: 'string' | 'number' | 'boolean' | 'date' | 'timestamp';
      }>;
      /** Reuse an identical Athena result for this many minutes. Athena does not detect source-data changes. */
      resultReuse?: { maxAgeMinutes: number };
    }>;
  };
  /** Deployment-managed reusable Athena views. */
  views?: Record<string, { sql: string }>;
  /** Scheduled Iceberg tables refreshed over a trailing time window. */
  models?: Record<string, {
    sql: string;
    schedule: string;
    partitionColumn: string;
    lookbackDays?: number;
  }>;
};

function validateQueries(queries: NonNullable<AnalyticsArgs['queryApi']>['queries']) {
  for (const [name, query] of Object.entries(queries)) {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      throw new Error(`Invalid analytics query name: ${name}. Names must be lower-kebab-case.`);
    }
    if (!query.sql.trim() || !/^(select|with)\b/i.test(query.sql.trim()) || /;\s*\S/.test(query.sql)) {
      throw new Error(`Analytics query ${name} must contain one read-only SELECT or WITH statement.`);
    }
    if ((query.sql.match(/\?/g) ?? []).length !== Object.keys(query.parameters ?? {}).length) {
      throw new Error(`Analytics query ${name} must have one ? placeholder for each declared parameter.`);
    }
    if (query.resultReuse && (!Number.isInteger(query.resultReuse.maxAgeMinutes) || query.resultReuse.maxAgeMinutes < 1 || query.resultReuse.maxAgeMinutes > 10_080)) {
      throw new Error(`Analytics query ${name} resultReuse.maxAgeMinutes must be between 1 and 10080.`);
    }
  }
}

function validateDefinitions(definitions: Record<string, unknown>, kind: 'view' | 'model') {
  for (const [name, definition] of Object.entries(definitions)) {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`Invalid analytics ${kind} name: ${name}. Names must be lower-kebab-case.`);
    if (!definition || typeof definition !== 'object' || !('sql' in definition) || typeof definition.sql !== 'string' || !definition.sql.trim()) {
      throw new Error(`Analytics ${kind} ${name} requires SQL.`);
    }
  }
}

function loadManifest(configRoot?: string): AnalyticsManifest {
  const manifestPath = path.join(
    configRoot ?? '',
    '.monorise',
    'analytics-manifest.json',
  );
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `Analytics requires ${manifestPath}. Run the Monorise generator before deploying.`,
    );
  }

  let manifest: AnalyticsManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as AnalyticsManifest;
  } catch {
    throw new Error(
      `Analytics manifest at ${manifestPath} is invalid. Run the Monorise generator before deploying.`,
    );
  }
  if (
    manifest.version !== 2 ||
    !Array.isArray(manifest.datasets) ||
    !Array.isArray(manifest.unnamedMutuals) ||
    typeof manifest.schemaFingerprint !== 'string'
  ) {
    throw new Error(
      `Analytics manifest at ${manifestPath} is invalid. Run the Monorise generator before deploying.`,
    );
  }
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(manifest.datasets))
    .digest('hex');
  if (fingerprint !== manifest.schemaFingerprint) {
    throw new Error(
      `Analytics manifest at ${manifestPath} is stale or has been modified. Run the Monorise generator before deploying.`,
    );
  }
  const identifiers = new Set<string>();
  for (const dataset of manifest.datasets) {
    if (
      !dataset.name ||
        !dataset.identifier ||
        !dataset.idColumn ||
        !Array.isArray(dataset.columns) ||
        !Array.isArray(dataset.endpoints) ||
      identifiers.has(dataset.identifier)
    ) {
      throw new Error(
        `Analytics manifest at ${manifestPath} contains invalid or colliding datasets. Run the Monorise generator before deploying.`,
      );
    }
    identifiers.add(dataset.identifier);
  }
  return manifest;
}

function athenaType(type: ManifestColumn['type']): string {
  return type === 'json' ? 'string' : type;
}

export class Analytics {
  public readonly bucket: { arn: $util.Input<string>; name: $util.Input<string> };
  public readonly glueDatabase: { name: $util.Input<string> };
  public readonly workgroup: { name: $util.Input<string> };
  public readonly deliveryStream: aws.kinesis.FirehoseDeliveryStream;
  public readonly dlq: sst.aws.Queue;
  public readonly schedule: sst.aws.CronV2;
  public readonly queryApi?: sst.aws.ApiGatewayV2;
  public readonly processorFunctionName: string;
  public readonly backfillFunctionName: string;

  constructor(
    id: string,
    args: AnalyticsArgs,
    table: sst.aws.Dynamo,
    alarmTopic: sst.aws.SnsTopic,
    configRoot?: string,
    logging?: sst.aws.FunctionArgs['logging'],
  ) {
    const manifest = loadManifest(configRoot);
    const datasets = manifest.datasets.map((dataset) => ({
      ...dataset,
      partition: {
        granularity: args.partitions?.[dataset.name] ?? dataset.partition.granularity,
      },
    }));
    const serializedManifest = JSON.stringify({
      datasets: datasets.map(({ kind, name, partition }) => ({ kind, name, partition })),
    });
    this.processorFunctionName = `${$app.stage}-${$app.name}-${id}-analytics-processor`;
    this.backfillFunctionName = `${$app.stage}-${$app.name}-${id}-analytics-backfill`;

    const managedBucket = args.resources?.bucket
      ? undefined
      : new aws.s3.Bucket(`${id}-analytics-bucket`, {
          forceDestroy: false,
          serverSideEncryptionConfiguration: {
            rule: {
              applyServerSideEncryptionByDefault: {
                sseAlgorithm: 'AES256',
              },
            },
          },
        }, { retainOnDelete: true });
    if (managedBucket) {
      new aws.s3.BucketPublicAccessBlock(`${id}-analytics-bucket-public-access`, {
        bucket: managedBucket.id,
        blockPublicAcls: true,
        blockPublicPolicy: true,
        ignorePublicAcls: true,
        restrictPublicBuckets: true,
      });
    }
    const managedDatabase = args.resources?.glueDatabase
      ? undefined
      : new aws.glue.CatalogDatabase(`${id}-analytics-database`, {}, { retainOnDelete: true });
    const managedWorkgroup = args.resources?.workgroup
      ? undefined
      : new aws.athena.Workgroup(`${id}-analytics-workgroup`, {
          configuration: {
            enforceWorkgroupConfiguration: true,
            publishCloudwatchMetricsEnabled: true,
            resultConfiguration: {
              outputLocation: $interpolate`s3://${managedBucket!.bucket}/athena-results/`,
              encryptionConfiguration: { encryptionOption: 'SSE_S3' },
            },
          },
        }, { retainOnDelete: true });

    this.bucket = args.resources?.bucket ?? { arn: managedBucket!.arn, name: managedBucket!.bucket };
    this.glueDatabase = args.resources?.glueDatabase ?? { name: managedDatabase!.name };
    this.workgroup = args.resources?.workgroup ?? { name: managedWorkgroup!.name };

    if (args.queryApi?.enabled !== false && args.queryApi) {
      validateQueries(args.queryApi.queries);
      const queryKeys = new sst.Secret('ANALYTICS_API_KEYS', '["analytics-secret-1", "analytics-secret-2"]');
      const executions = new sst.aws.Dynamo(`${id}-analytics-executions`, {
        fields: { id: 'string' },
        primaryIndex: { hashKey: 'id' },
        ttl: 'expiresAt',
      });
      this.queryApi = new sst.aws.ApiGatewayV2(`${id}-analytics-api`);
      this.queryApi.route('ANY /analytics/{proxy+}', {
        name: `${$app.stage}-${$app.name}-${id}-analytics-query-api`,
        handler: path.join(configRoot ?? '', '.monorise/handle.analyticsQueryHandler'),
        runtime: 'nodejs22.x',
        timeout: '30 seconds',
        memory: '512 MB',
        logging,
        link: [executions, queryKeys],
        environment: {
          ANALYTICS_API_KEYS: queryKeys.value,
          ANALYTICS_EXECUTIONS_TABLE: executions.name,
          ANALYTICS_QUERIES: JSON.stringify(args.queryApi.queries),
          ANALYTICS_DATABASE: this.glueDatabase.name,
          ANALYTICS_WORKGROUP: this.workgroup.name,
          ANALYTICS_ATHENA_OUTPUT: $interpolate`s3://${this.bucket.name}/athena-results/`,
        },
        permissions: [
          { actions: ['athena:StartQueryExecution', 'athena:GetQueryExecution', 'athena:GetQueryResults', 'athena:StopQueryExecution'], resources: ['*'] },
          { actions: ['glue:GetDatabase', 'glue:GetTable'], resources: ['*'] },
          { actions: ['s3:GetBucketLocation', 's3:GetObject', 's3:ListBucket', 's3:PutObject'], resources: [this.bucket.arn, $interpolate`${this.bucket.arn}/*`] },
        ],
      });
    }

    const athenaPermissions = [
      { actions: ['athena:StartQueryExecution', 'athena:GetQueryExecution'], resources: ['*'] },
      { actions: ['glue:GetDatabase', 'glue:GetTable', 'glue:CreateTable', 'glue:UpdateTable'], resources: ['*'] },
      { actions: ['s3:GetBucketLocation', 's3:GetObject', 's3:ListBucket', 's3:PutObject', 's3:DeleteObject'], resources: [this.bucket.arn, $interpolate`${this.bucket.arn}/*`] },
    ];
    if (args.views) {
      validateDefinitions(args.views, 'view');
      for (const [name, view] of Object.entries(args.views)) {
        const viewFunction = new sst.aws.Function(`${id}-${name}-analytics-view`, {
          handler: path.join(configRoot ?? '', '.monorise/handle.analyticsViewHandler'),
          runtime: 'nodejs22.x', timeout: '15 minutes', memory: '512 MB', logging,
          environment: {
            ANALYTICS_VIEW: JSON.stringify({ name, sql: view.sql }), ANALYTICS_DATABASE: this.glueDatabase.name,
            ANALYTICS_WORKGROUP: this.workgroup.name, ANALYTICS_ATHENA_OUTPUT: $interpolate`s3://${this.bucket.name}/athena-results/`,
          }, permissions: athenaPermissions,
        });
        new aws.lambda.Invocation(`${id}-${name}-analytics-view-apply`, {
          // Changing the definition changes the invocation input and reapplies the view.
          functionName: viewFunction.name, input: JSON.stringify({ sql: view.sql }),
        });
      }
    }
    if (args.models) {
      validateDefinitions(args.models, 'model');
      for (const [name, model] of Object.entries(args.models)) {
        if (!model.partitionColumn || !/^[a-z][a-z0-9_]*$/.test(model.partitionColumn)) throw new Error(`Analytics model ${name} requires a snake_case partitionColumn.`);
        if (model.lookbackDays !== undefined && (!Number.isInteger(model.lookbackDays) || model.lookbackDays < 1)) throw new Error(`Analytics model ${name} lookbackDays must be a positive integer.`);
        new sst.aws.CronV2(`${id}-${name}-analytics-model`, {
          schedule: model.schedule,
          function: {
            handler: path.join(configRoot ?? '', '.monorise/handle.analyticsModelHandler'),
            runtime: 'nodejs22.x', timeout: '15 minutes', memory: '1024 MB', logging,
            environment: {
              ANALYTICS_MODEL: JSON.stringify({ name, sql: model.sql, partitionColumn: model.partitionColumn, lookbackDays: model.lookbackDays ?? 3 }),
              ANALYTICS_DATABASE: this.glueDatabase.name, ANALYTICS_BUCKET: this.bucket.name,
              ANALYTICS_WORKGROUP: this.workgroup.name, ANALYTICS_ATHENA_OUTPUT: $interpolate`s3://${this.bucket.name}/athena-results/`,
            }, permissions: athenaPermissions,
          },
        });
      }
    }

    const firehoseRole = new aws.iam.Role(`${id}-analytics-firehose-role`, {
      assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ Service: 'firehose.amazonaws.com' }),
    });
    new aws.iam.RolePolicy(`${id}-analytics-firehose-policy`, {
      role: firehoseRole.id,
      policy: $resolve([this.bucket.arn]).apply(([bucketArn]) => JSON.stringify({
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Action: ['s3:AbortMultipartUpload', 's3:GetBucketLocation', 's3:GetObject', 's3:ListBucket', 's3:PutObject'], Resource: [bucketArn, `${bucketArn}/*`] }],
      })),
    });
    this.deliveryStream = new aws.kinesis.FirehoseDeliveryStream(`${id}-analytics-delivery`, {
      destination: 'extended_s3',
      extendedS3Configuration: {
        roleArn: firehoseRole.arn,
        bucketArn: this.bucket.arn,
        bufferingInterval: 300,
        // Firehose requires at least 64 MiB when dynamic partitioning is enabled.
        bufferingSize: 64,
        compressionFormat: 'GZIP',
        prefix: 'history/!{partitionKeyFromQuery:path}/',
        errorOutputPrefix: 'errors/!{firehose:error-output-type}/',
        dynamicPartitioningConfiguration: { enabled: true },
        processingConfiguration: {
          enabled: true,
          processors: [{ type: 'MetadataExtraction', parameters: [{ parameterName: 'MetadataExtractionQuery', parameterValue: '{path:.path}' }, { parameterName: 'JsonParsingEngine', parameterValue: 'JQ-1.6' }] }],
        },
      },
    });

    this.dlq = new sst.aws.Queue(`${id}-analytics-dlq`);
    table.subscribe(`${id}-analytics`, {
      name: this.processorFunctionName,
      handler: path.join(configRoot ?? '', '.monorise/handle.analyticsHandler'),
      runtime: 'nodejs22.x',
      timeout: '60 seconds',
      memory: '512 MB',
      logging,
      link: [table, this.dlq],
      environment: {
        ANALYTICS_DELIVERY_STREAM: this.deliveryStream.name,
        ANALYTICS_MANIFEST: serializedManifest,
        ANALYTICS_OMIT_FIELDS: JSON.stringify(args.fields?.omit ?? []),
      },
      permissions: [{ actions: ['firehose:PutRecordBatch'], resources: [this.deliveryStream.arn] }],
    }, {
      transform: { eventSourceMapping: { startingPosition: 'LATEST', bisectBatchOnFunctionError: true, maximumRetryAttempts: 1, destinationConfig: { onFailure: { destinationArn: this.dlq.arn } } } },
    });

    new aws.cloudwatch.MetricAlarm(`${id}-analytics-dlq-alarm`, {
      name: `${id}-analytics-dlq`, namespace: 'AWS/SQS', metricName: 'ApproximateNumberOfMessagesVisible', statistic: 'Maximum', period: 300, evaluationPeriods: 1, threshold: 1, comparisonOperator: 'GreaterThanOrEqualToThreshold', alarmActions: [alarmTopic.arn], dimensions: { QueueName: this.dlq.nodes.queue.name },
    });
    new aws.cloudwatch.MetricAlarm(`${id}-analytics-iterator-age`, {
      name: `${id}-analytics-iterator-age`, namespace: 'AWS/Lambda', metricName: 'IteratorAge', statistic: 'Maximum', period: 300, evaluationPeriods: 1, threshold: 300000, comparisonOperator: 'GreaterThanThreshold', alarmActions: [alarmTopic.arn], dimensions: { FunctionName: this.processorFunctionName },
    });
    new aws.cloudwatch.MetricAlarm(`${id}-analytics-firehose-failures`, {
      name: `${id}-analytics-firehose-failures`, namespace: 'AWS/Firehose', metricName: 'DeliveryToS3.DataFreshness', statistic: 'Maximum', period: 300, evaluationPeriods: 1, threshold: 900, comparisonOperator: 'GreaterThanThreshold', alarmActions: [alarmTopic.arn], dimensions: { DeliveryStreamName: this.deliveryStream.name },
    });

    if (args.resources?.bucket && !args.resources.bucket.notificationsManaged) {
      throw new Error(
        'Analytics backfill requires exclusive management of S3 bucket notifications. S3 only permits one notification configuration; ensure the supplied bucket has no existing notifications, then set analytics.resources.bucket.notificationsManaged to true.',
      );
    }
    const backfillPrefix = 'backfill';
    const backfillFunction = new sst.aws.Function(`${id}-analytics-backfill`, {
      name: this.backfillFunctionName,
      handler: path.join(configRoot ?? '', '.monorise/handle.analyticsBackfillHandler'),
      runtime: 'nodejs22.x',
      timeout: '15 minutes',
      memory: '1024 MB',
      logging,
      environment: {
        ANALYTICS_TABLE_ARN: table.arn,
        ANALYTICS_BACKFILL_MARKER_TABLE: table.name,
        ANALYTICS_BACKFILL_BUCKET: this.bucket.name,
        ANALYTICS_BACKFILL_PREFIX: backfillPrefix,
        ANALYTICS_DELIVERY_STREAM: this.deliveryStream.name,
        ANALYTICS_MANIFEST: serializedManifest,
        ANALYTICS_OMIT_FIELDS: JSON.stringify(args.fields?.omit ?? []),
      },
      permissions: [
        { actions: ['dynamodb:ExportTableToPointInTime', 'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'], resources: [table.arn] },
        { actions: ['s3:GetObject'], resources: [$interpolate`${this.bucket.arn}/${backfillPrefix}/*`] },
        { actions: ['firehose:PutRecordBatch'], resources: [this.deliveryStream.arn] },
      ],
    });
    const backfillPermission = new aws.lambda.Permission(`${id}-analytics-backfill-s3-permission`, {
      action: 'lambda:InvokeFunction',
      function: backfillFunction.name,
      principal: 's3.amazonaws.com',
      sourceArn: this.bucket.arn,
    });
    const backfillNotification = new aws.s3.BucketNotification(`${id}-analytics-backfill-notification`, {
      bucket: this.bucket.name,
      lambdaFunctions: [{ lambdaFunctionArn: backfillFunction.arn, events: ['s3:ObjectCreated:*'], filterPrefix: `${backfillPrefix}/AWSDynamoDB/` }],
    }, { dependsOn: [backfillPermission] });
    new aws.lambda.Invocation(`${id}-analytics-backfill-launch`, {
      functionName: backfillFunction.name,
      // This resource is recreated after analytics is disabled, so reconcile
      // current state when delivery is enabled again.
      input: JSON.stringify({ action: 'reconcile' }),
    }, { dependsOn: [backfillNotification] });
    new aws.cloudwatch.MetricAlarm(`${id}-analytics-backfill-errors`, {
      name: `${id}-analytics-backfill-errors`, namespace: 'AWS/Lambda', metricName: 'Errors', statistic: 'Sum', period: 300, evaluationPeriods: 1, threshold: 1, comparisonOperator: 'GreaterThanOrEqualToThreshold', alarmActions: [alarmTopic.arn], dimensions: { FunctionName: this.backfillFunctionName },
    });

    for (const dataset of datasets) {
      const rawTable = `${dataset.historyTable}_raw`;
      const rawLocation = $resolve([this.bucket.name]).apply(
        ([bucketName]) =>
          `s3://${bucketName}/history/${dataset.kind === 'entity' ? 'entities' : 'mutuals'}/${dataset.name}/`,
      );
      const projection: Record<string, $util.Input<string>> = dataset.partition.granularity === 'hour'
        ? {
            'projection.event_hour.type': 'integer',
            'projection.event_hour.range': '0,23',
            'projection.event_hour.digits': '2',
            'storage.location.template': rawLocation.apply(
              (location) => `${location}event_date=\${event_date}/event_hour=\${event_hour}/`,
            ),
          }
        : {
            'storage.location.template': rawLocation.apply(
              (location) => `${location}event_date=\${event_date}/`,
            ),
          };
      new aws.glue.CatalogTable(`${id}-${dataset.identifier}-raw`, {
        databaseName: this.glueDatabase.name,
        name: rawTable,
        tableType: 'EXTERNAL_TABLE',
        parameters: {
          EXTERNAL: 'TRUE',
          'projection.enabled': 'true',
          'projection.event_date.type': 'date',
          'projection.event_date.range': '2020-01-01,NOW',
          'projection.event_date.format': 'yyyy-MM-dd',
          ...projection,
        },
        storageDescriptor: {
          location: rawLocation,
          inputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
          serDeInfo: { serializationLibrary: 'org.openx.data.jsonserde.JsonSerDe' },
          columns: [
            { name: 'event_id', type: 'string' },
            { name: 'idempotency_key', type: 'string' },
            { name: 'ordering_key', type: 'string' },
            { name: 'sequence_number', type: 'string' },
            { name: 'operation', type: 'string' },
            { name: 'occurred_at', type: 'string' },
            { name: 'dataset', type: 'string' },
            { name: 'kind', type: 'string' },
            { name: 'path', type: 'string' },
            { name: 'before', type: 'string' },
            { name: 'after', type: 'string' },
          ],
        },
        partitionKeys: [{ name: 'event_date', type: 'string' }, ...(dataset.partition.granularity === 'hour' ? [{ name: 'event_hour', type: 'string' }] : [])],
      });
    }
    this.schedule = new sst.aws.CronV2(`${id}-analytics-daily`, {
      schedule: 'cron(0 0 * * ? *)',
      function: {
        handler: path.join(configRoot ?? '', '.monorise/handle.analyticsMaterializationHandler'),
        runtime: 'nodejs22.x',
        timeout: '15 minutes',
        memory: '1024 MB',
        logging,
        environment: {
          ANALYTICS_DATABASE: this.glueDatabase.name,
          ANALYTICS_BUCKET: this.bucket.name,
          ANALYTICS_WORKGROUP: this.workgroup.name,
          ANALYTICS_ATHENA_OUTPUT: $interpolate`s3://${this.bucket.name}/athena-results/`,
        },
        permissions: [
          { actions: ['athena:StartQueryExecution', 'athena:GetQueryExecution', 'athena:GetQueryResults'], resources: ['*'] },
          { actions: ['glue:GetDatabase', 'glue:GetTable', 'glue:CreateTable', 'glue:UpdateTable'], resources: ['*'] },
          { actions: ['s3:GetBucketLocation', 's3:GetObject', 's3:PutObject', 's3:ListBucket'], resources: [this.bucket.arn, $interpolate`${this.bucket.arn}/*`] },
        ],
      },
    });
  }
}
