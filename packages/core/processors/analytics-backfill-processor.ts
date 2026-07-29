import {
  DeleteItemCommand,
  DynamoDBClient,
  ExportTableToPointInTimeCommand,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { FirehoseClient, PutRecordBatchCommand } from '@aws-sdk/client-firehose';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import type { Entity as EntityType, createEntityConfig } from '@monorise/base';
import { gunzipSync } from 'node:zlib';
import {
  datasetForRecord,
  encodeAnalyticsEvent,
  parseAnalyticsManifest,
  sanitizeItem,
  type AnalyticsEvent,
} from './analytics-processor';

const dynamodb = new DynamoDBClient();
const firehose = new FirehoseClient();
const s3 = new S3Client();

type Config = Record<EntityType, ReturnType<typeof createEntityConfig>>;

type S3ExportEvent = {
  Records: { s3: { bucket: { name: string }; object: { key: string } } }[];
};

type BackfillLaunchEvent = { action: 'start' | 'reconcile' };

const backfillMarker = { PK: '#ANALYTICS#', SK: '#BACKFILL#' };

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function exportTimestamp(): Date {
  const value = process.env.ANALYTICS_EXPORT_TIME;
  const timestamp = value ? new Date(value) : new Date();
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error('ANALYTICS_EXPORT_TIME must be an ISO-8601 timestamp.');
  }
  return timestamp;
}

/** Starts a consistent export after stream capture has been enabled by infrastructure. */
export async function startBackfill(reconcile = false) {
  const timestamp = exportTimestamp();
  const tableName = required('ANALYTICS_BACKFILL_MARKER_TABLE');
  const marker = marshall({ ...backfillMarker, exportTime: timestamp.toISOString(), state: 'starting' });
  let createdMarker = false;
  try {
    await dynamodb.send(new PutItemCommand({ TableName: tableName, Item: marker, ConditionExpression: 'attribute_not_exists(PK)' }));
    createdMarker = true;
  } catch (error) {
    if ((error as { name?: string }).name !== 'ConditionalCheckFailedException') throw error;
    if (reconcile) {
      await dynamodb.send(new UpdateItemCommand({
        TableName: tableName,
        Key: marshall(backfillMarker),
        UpdateExpression: 'SET exportTime = :exportTime, #state = :state REMOVE exportArn',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: marshall({ ':exportTime': timestamp.toISOString(), ':state': 'starting' }),
      }));
    } else {
    const existing = await dynamodb.send(new GetItemCommand({ TableName: tableName, Key: marshall(backfillMarker), ConsistentRead: true }));
    const value = existing.Item ? unmarshall(existing.Item) : {};
    return { exportArn: value.exportArn as string | undefined, exportTime: value.exportTime as string | undefined, started: false };
    }
  }

  let result;
  try {
    result = await dynamodb.send(new ExportTableToPointInTimeCommand({
      TableArn: required('ANALYTICS_TABLE_ARN'),
      S3Bucket: required('ANALYTICS_BACKFILL_BUCKET'),
      S3Prefix: process.env.ANALYTICS_BACKFILL_PREFIX ?? 'backfill',
      ExportTime: timestamp,
      ExportFormat: 'DYNAMODB_JSON',
    }));
  } catch (error) {
    if (createdMarker) {
      await dynamodb.send(new DeleteItemCommand({
        TableName: tableName,
        Key: marshall(backfillMarker),
        ConditionExpression: 'exportTime = :exportTime',
        ExpressionAttributeValues: marshall({ ':exportTime': timestamp.toISOString() }),
      }));
    } else {
      await dynamodb.send(new UpdateItemCommand({
        TableName: tableName,
        Key: marshall(backfillMarker),
        UpdateExpression: 'SET #state = :state',
        ConditionExpression: 'exportTime = :exportTime',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: marshall({ ':state': 'failed', ':exportTime': timestamp.toISOString() }),
      }));
    }
    throw error;
  }
  await dynamodb.send(new UpdateItemCommand({
    TableName: tableName,
    Key: marshall(backfillMarker),
    UpdateExpression: 'SET #state = :state, exportArn = :exportArn',
    ConditionExpression: 'exportTime = :exportTime',
    ExpressionAttributeNames: { '#state': 'state' },
    ExpressionAttributeValues: marshall({ ':state': 'started', ':exportArn': result.ExportDescription?.ExportArn, ':exportTime': timestamp.toISOString() }, { removeUndefinedValues: true }),
  }));
  return { exportArn: result.ExportDescription?.ExportArn, exportTime: timestamp.toISOString(), started: true };
}

async function backfillTimestamp(): Promise<Date> {
  const tableName = process.env.ANALYTICS_BACKFILL_MARKER_TABLE;
  if (!tableName) return exportTimestamp();
  const result = await dynamodb.send(new GetItemCommand({ TableName: tableName, Key: marshall(backfillMarker), ConsistentRead: true }));
  const value = result.Item ? unmarshall(result.Item).exportTime : undefined;
  if (typeof value !== 'string') throw new Error('Analytics backfill marker is missing its export timestamp.');
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) throw new Error('Analytics backfill marker has an invalid export timestamp.');
  return timestamp;
}

function streamToBuffer(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
  return (async () => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
  })();
}

export function snapshotEvent(
  item: Record<string, unknown>,
  config: Config,
  occurredAt: Date,
  omittedFields: Set<string>,
): AnalyticsEvent | undefined {
  const attributes = marshall(item, { removeUndefinedValues: true });
  // datasetForRecord only examines key/type string attributes; retain the full item below.
  const dataset = datasetForRecord({ dynamodb: { NewImage: attributes } }, parseAnalyticsManifest(), config);
  if (!dataset) return undefined;
  const after = sanitizeItem(item, omittedFields);
  const key = `${String(item.PK)}:${String(item.SK)}`;
  const path = `${dataset.kind === 'entity' ? 'entities' : 'mutuals'}/${dataset.name}/event_date=${occurredAt.toISOString().slice(0, 10)}${dataset.granularity === 'hour' ? `/event_hour=${occurredAt.toISOString().slice(11, 13)}` : ''}`;
  return {
    eventId: `snapshot:${key}:${occurredAt.toISOString()}`,
    idempotencyKey: `snapshot:${key}:${occurredAt.toISOString()}`,
    orderingKey: occurredAt.toISOString(),
    operation: 'SNAPSHOT',
    occurredAt: occurredAt.toISOString(),
    dataset: dataset.name,
    kind: dataset.kind,
    path,
    after,
  };
}

export const handler = (config: Config) => async (event: S3ExportEvent | BackfillLaunchEvent) => {
  if (!('Records' in event)) {
    if (event.action === 'start') return startBackfill();
    if (event.action === 'reconcile') return startBackfill(true);
    throw new Error('Unsupported analytics backfill event.');
  }
  const timestamp = await backfillTimestamp();
  const omittedFields = new Set(JSON.parse(process.env.ANALYTICS_OMIT_FIELDS ?? '[]') as string[]);
  const deliveryStream = required('ANALYTICS_DELIVERY_STREAM');
  let delivered = 0;

  for (const record of event.Records) {
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
    if (!key.endsWith('.json.gz')) continue;
    const response = await s3.send(new GetObjectCommand({ Bucket: record.s3.bucket.name, Key: key }));
    if (!response.Body) throw new Error(`Backfill export object ${key} has no body.`);
    const content = gunzipSync(await streamToBuffer(response.Body as AsyncIterable<Uint8Array>)).toString('utf8');
    const events = content.split('\n').filter(Boolean).flatMap((line) => {
      const attributes = JSON.parse(line).Item;
      return attributes ? [snapshotEvent(unmarshall(attributes), config, timestamp, omittedFields)].filter(Boolean) as AnalyticsEvent[] : [];
    });
    for (let index = 0; index < events.length; index += 500) {
      const batch = events.slice(index, index + 500);
        const result = await firehose.send(new PutRecordBatchCommand({ DeliveryStreamName: deliveryStream, Records: batch.map((value) => ({ Data: Buffer.from(`${JSON.stringify(encodeAnalyticsEvent(value))}\n`) })) }));
      if (result.FailedPutCount) throw new Error(`Failed to deliver ${result.FailedPutCount} backfill records; retry this export object.`);
      delivered += batch.length;
    }
  }
  return { delivered, exportTime: timestamp.toISOString() };
};
