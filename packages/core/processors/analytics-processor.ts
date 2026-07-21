import {
  FirehoseClient,
  PutRecordBatchCommand,
} from '@aws-sdk/client-firehose';
import type { _Record as DynamoDBStreamRecord } from '@aws-sdk/client-dynamodb-streams';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { Entity as EntityType, createEntityConfig } from '@monorise/base';
import type { DynamoDBBatchItemFailure } from 'aws-lambda';

export type AnalyticsManifest = {
  datasets: {
    kind: 'entity' | 'mutual';
    name: string;
    partition: { granularity: 'day' | 'hour' };
  }[];
};

export type AnalyticsEvent = {
  eventId: string;
  idempotencyKey: string;
  orderingKey: string;
  sequenceNumber?: string;
  operation: 'INSERT' | 'MODIFY' | 'REMOVE' | 'SNAPSHOT';
  occurredAt: string;
  dataset: string;
  kind: 'entity' | 'mutual';
  path: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
};

const firehose = new FirehoseClient();

export function encodeAnalyticsEvent(event: AnalyticsEvent) {
  return {
    event_id: event.eventId,
    idempotency_key: event.idempotencyKey,
    ordering_key: event.orderingKey,
    sequence_number: event.sequenceNumber,
    operation: event.operation,
    occurred_at: event.occurredAt,
    dataset: event.dataset,
    kind: event.kind,
    path: event.path,
    before: event.before ? JSON.stringify(event.before) : undefined,
    after: event.after ? JSON.stringify(event.after) : undefined,
  };
}

export function omitTopLevelFields(
  value: Record<string, unknown> | undefined,
  fields: Set<string>,
): Record<string, unknown> | undefined {
  if (!value) return value;
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !fields.has(key)),
  );
}

export function sanitizeItem(
  item: Record<string, unknown> | undefined,
  omittedFields: Set<string>,
): Record<string, unknown> | undefined {
  if (!item) return item;
  return {
    ...item,
    data: omitTopLevelFields(
      item.data as Record<string, unknown> | undefined,
      omittedFields,
    ),
    mutualData: omitTopLevelFields(
      item.mutualData as Record<string, unknown> | undefined,
      omittedFields,
    ),
  };
}

export function parseAnalyticsManifest(): AnalyticsManifest {
  const raw = process.env.ANALYTICS_MANIFEST;
  if (!raw) throw new Error('ANALYTICS_MANIFEST is required.');
  return JSON.parse(raw) as AnalyticsManifest;
}

export function datasetForRecord(
  record: DynamoDBStreamRecord,
  manifest: AnalyticsManifest,
  config: Record<EntityType, ReturnType<typeof createEntityConfig>>,
): { name: string; kind: 'entity' | 'mutual'; granularity: 'day' | 'hour' } | undefined {
  const image = record.dynamodb?.NewImage ?? record.dynamodb?.OldImage;
  if (!image?.PK?.S || image.SK?.S !== '#METADATA#') return undefined;

  if (!image.PK.S.startsWith('MUTUAL#')) {
    const entityType = image.entityType?.S;
    const dataset = manifest.datasets.find(
      (candidate) => candidate.kind === 'entity' && candidate.name === entityType,
    );
  return dataset && {
      name: dataset.name,
      kind: dataset.kind,
      granularity: dataset.partition.granularity,
    };
  }

  const item = unmarshall(image);
  const pair = [item.byEntityType, item.entityType].sort().join('::');
  for (const entityConfig of Object.values(config)) {
    for (const field of Object.values(
      entityConfig.mutual?.mutualFields ?? {},
    )) {
      const mutual = field.mutual;
      if (!mutual?.name) continue;
      if ([entityConfig.name, field.entityType].sort().join('::') !== pair) continue;
      const dataset = manifest.datasets.find(
        (candidate) => candidate.kind === 'mutual' && candidate.name === mutual.name,
      );
      return dataset && {
        name: dataset.name,
        kind: dataset.kind,
        granularity: dataset.partition.granularity,
      };
    }
  }
}

export const handler = (
  config: Record<EntityType, ReturnType<typeof createEntityConfig>>,
) => async (event: { Records: DynamoDBStreamRecord[] }) => {
  const streamName = process.env.ANALYTICS_DELIVERY_STREAM;
  if (!streamName) throw new Error('ANALYTICS_DELIVERY_STREAM is required.');

  const manifest = parseAnalyticsManifest();
  const omittedFields = new Set(
    JSON.parse(process.env.ANALYTICS_OMIT_FIELDS ?? '[]') as string[],
  );
  const failures: DynamoDBBatchItemFailure[] = [];
  const events: { record: DynamoDBStreamRecord; event: AnalyticsEvent }[] = [];

  for (const record of event.Records) {
    try {
      const dataset = datasetForRecord(record, manifest, config);
      if (!dataset || !record.eventName || !record.eventID) continue;
      const occurredAt = new Date(
        Number(
          record.dynamodb?.ApproximateCreationDateTime ?? Date.now() / 1000,
        ) * 1000,
      );
      const eventDate = occurredAt.toISOString().slice(0, 10);
      const eventHour = occurredAt.toISOString().slice(11, 13);
      const path = `${dataset.kind === 'entity' ? 'entities' : 'mutuals'}/${dataset.name}/event_date=${eventDate}${dataset.granularity === 'hour' ? `/event_hour=${eventHour}` : ''}`;

      events.push({
        record,
        event: {
          eventId: record.eventID,
          idempotencyKey: record.eventID,
          orderingKey: record.dynamodb?.SequenceNumber ?? record.eventID,
          sequenceNumber: record.dynamodb?.SequenceNumber,
          operation: record.eventName as AnalyticsEvent['operation'],
          occurredAt: occurredAt.toISOString(),
          dataset: dataset.name,
          kind: dataset.kind,
          path,
          before: sanitizeItem(
            record.dynamodb?.OldImage
              ? unmarshall(record.dynamodb.OldImage)
              : undefined,
            omittedFields,
          ),
          after: sanitizeItem(
            record.dynamodb?.NewImage
              ? unmarshall(record.dynamodb.NewImage)
              : undefined,
            omittedFields,
          ),
        },
      });
    } catch (error) {
      console.error('Unable to normalize analytics stream record', error);
      failures.push({ itemIdentifier: record.dynamodb?.SequenceNumber ?? '' });
    }
  }

  for (let index = 0; index < events.length; index += 500) {
    const batch = events.slice(index, index + 500);
    const result = await firehose.send(
      new PutRecordBatchCommand({
        DeliveryStreamName: streamName,
        Records: batch.map(({ event: value }) => ({
          Data: Buffer.from(`${JSON.stringify(encodeAnalyticsEvent(value))}\n`),
        })),
      }),
    );
    result.RequestResponses?.forEach((response, responseIndex) => {
      if (!response.ErrorCode) return;
      failures.push({
        itemIdentifier:
          batch[responseIndex]?.record.dynamodb?.SequenceNumber ?? '',
      });
    });
  }

  return { batchItemFailures: failures };
};
