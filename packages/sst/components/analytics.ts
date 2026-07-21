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
  currentTable: string;
  historyTable: string;
  columns: ManifestColumn[];
  partition: { granularity: 'day' | 'hour' };
};

type AnalyticsManifest = {
  version: 1;
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
  key?: { arn: $util.Input<string> };
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
};

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
    manifest.version !== 1 ||
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
      !Array.isArray(dataset.columns) ||
      identifiers.has(dataset.identifier)
    ) {
      throw new Error(
        `Analytics manifest at ${manifestPath} contains invalid or colliding datasets. Run the Monorise generator before deploying.`,
      );
    }
    identifiers.add(dataset.identifier);
  }
  if (manifest.unnamedMutuals.length > 0) {
    throw new Error(
      `Analytics requires named mutual configs. Add names for: ${manifest.unnamedMutuals.join(', ')}.`,
    );
  }
  return manifest;
}

function athenaType(type: ManifestColumn['type']): string {
  return type === 'json' ? 'string' : type;
}

export class Analytics {
  public readonly bucket: { arn: $util.Input<string>; name: $util.Input<string> };
  public readonly key: { arn: $util.Input<string> };
  public readonly glueDatabase: { name: $util.Input<string> };
  public readonly workgroup: { name: $util.Input<string> };
  public readonly deliveryStream: aws.kinesis.FirehoseDeliveryStream;
  public readonly dlq: sst.aws.Queue;
  public readonly schedule: sst.aws.CronV2;
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
    this.processorFunctionName = `${$app.stage}-${$app.name}-${id}-analytics-processor`;
    this.backfillFunctionName = `${$app.stage}-${$app.name}-${id}-analytics-backfill`;

    const managedKey = args.resources?.key
      ? undefined
      : new aws.kms.Key(`${id}-analytics-key`, {
          description: 'Monorise analytics encryption key',
          enableKeyRotation: true,
          deletionWindowInDays: 30,
        }, { retainOnDelete: true });
    const managedBucket = args.resources?.bucket
      ? undefined
      : new aws.s3.Bucket(`${id}-analytics-bucket`, {
          forceDestroy: false,
          serverSideEncryptionConfiguration: {
            rule: {
              applyServerSideEncryptionByDefault: {
                kmsMasterKeyId: managedKey?.arn,
                sseAlgorithm: 'aws:kms',
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
              encryptionConfiguration: { encryptionOption: 'SSE_KMS', kmsKeyArn: managedKey!.arn },
            },
          },
        }, { retainOnDelete: true });

    this.bucket = args.resources?.bucket ?? { arn: managedBucket!.arn, name: managedBucket!.bucket };
    this.key = args.resources?.key ?? { arn: managedKey!.arn };
    this.glueDatabase = args.resources?.glueDatabase ?? { name: managedDatabase!.name };
    this.workgroup = args.resources?.workgroup ?? { name: managedWorkgroup!.name };

    const firehoseRole = new aws.iam.Role(`${id}-analytics-firehose-role`, {
      assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ Service: 'firehose.amazonaws.com' }),
    });
    new aws.iam.RolePolicy(`${id}-analytics-firehose-policy`, {
      role: firehoseRole.id,
      policy: $resolve([this.bucket.arn, this.key.arn]).apply(([bucketArn, keyArn]) => JSON.stringify({
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Action: ['s3:AbortMultipartUpload', 's3:GetBucketLocation', 's3:GetObject', 's3:ListBucket', 's3:PutObject'], Resource: [bucketArn, `${bucketArn}/*`] }, { Effect: 'Allow', Action: ['kms:Decrypt', 'kms:GenerateDataKey'], Resource: keyArn }],
      })),
    });
    this.deliveryStream = new aws.kinesis.FirehoseDeliveryStream(`${id}-analytics-delivery`, {
      destination: 'extended_s3',
      extendedS3Configuration: {
        roleArn: firehoseRole.arn,
        bucketArn: this.bucket.arn,
        bufferingInterval: 300,
        bufferingSize: 5,
        compressionFormat: 'GZIP',
        kmsKeyArn: this.key.arn,
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
        ANALYTICS_MANIFEST: JSON.stringify({ ...manifest, datasets }),
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
        ANALYTICS_MANIFEST: JSON.stringify({ ...manifest, datasets }),
        ANALYTICS_OMIT_FIELDS: JSON.stringify(args.fields?.omit ?? []),
      },
      permissions: [
        { actions: ['dynamodb:ExportTableToPointInTime', 'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'], resources: [table.arn] },
        { actions: ['s3:GetObject'], resources: [$interpolate`${this.bucket.arn}/${backfillPrefix}/*`] },
        { actions: ['firehose:PutRecordBatch'], resources: [this.deliveryStream.arn] },
        { actions: ['kms:Decrypt', 'kms:GenerateDataKey'], resources: [this.key.arn] },
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
      input: JSON.stringify({ action: 'start' }),
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
          ANALYTICS_MANIFEST: JSON.stringify({ ...manifest, datasets }),
          ANALYTICS_DATABASE: this.glueDatabase.name,
          ANALYTICS_BUCKET: this.bucket.name,
          ANALYTICS_WORKGROUP: this.workgroup.name,
          ANALYTICS_ATHENA_OUTPUT: $interpolate`s3://${this.bucket.name}/athena-results/`,
        },
        permissions: [
          { actions: ['athena:StartQueryExecution', 'athena:GetQueryExecution', 'athena:GetQueryResults'], resources: ['*'] },
          { actions: ['glue:GetDatabase', 'glue:GetTable', 'glue:CreateTable', 'glue:UpdateTable'], resources: ['*'] },
          { actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket'], resources: [this.bucket.arn, $interpolate`${this.bucket.arn}/*`] },
          { actions: ['kms:Decrypt', 'kms:GenerateDataKey'], resources: [this.key.arn] },
        ],
      },
    });
  }
}
