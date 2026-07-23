import { PutRecordBatchCommand } from '@aws-sdk/client-firehose';
import { describe, expect, test, vi } from 'vitest';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@aws-sdk/client-firehose', () => ({
  FirehoseClient: class { send = send; },
  PutRecordBatchCommand: class { constructor(public input: unknown) {} },
}));

import { handler } from './analytics-processor';

const manifest = {
  datasets: [
    { kind: 'entity', name: 'participant', partition: { granularity: 'day' } },
    { kind: 'entity', name: 'hourly', partition: { granularity: 'hour' } },
  ],
};

function image(entityType: string, data: Record<string, unknown>) {
  return {
    PK: { S: `${entityType}#one` }, SK: { S: '#METADATA#' }, entityType: { S: entityType },
    data: { M: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, { S: String(value) }])) },
  };
}

describe('analytics stream processor', () => {
  test('writes canonical updates with omissions, idempotency, and daily partitions', async () => {
    process.env.ANALYTICS_DELIVERY_STREAM = 'history';
    process.env.ANALYTICS_MANIFEST = JSON.stringify(manifest);
    process.env.ANALYTICS_OMIT_FIELDS = JSON.stringify(['passwordHash']);
    send.mockResolvedValue({ RequestResponses: [{}] });

    const result = await handler({} as never)({ Records: [{ eventID: 'event-1', eventName: 'MODIFY', dynamodb: { SequenceNumber: '42', ApproximateCreationDateTime: 1735689600, OldImage: image('participant', { passwordHash: 'old', name: 'Ada' }), NewImage: image('participant', { passwordHash: 'new', name: 'Grace' }) } }] });

    expect(result.batchItemFailures).toEqual([]);
    const command = send.mock.calls[0][0] as PutRecordBatchCommand;
    const event = JSON.parse((command.input as { Records: { Data: Buffer }[] }).Records[0].Data.toString());
    expect(event).toMatchObject({ event_id: 'event-1', idempotency_key: 'event-1', ordering_key: '42', operation: 'MODIFY', path: 'entities/participant/event_date=2025-01-01' });
    expect(JSON.parse(event.before).data).toEqual({ name: 'Ada' });
    expect(JSON.parse(event.after).data).toEqual({ name: 'Grace' });
  });

  test('filters derived rows and uses hourly partitions', async () => {
    process.env.ANALYTICS_DELIVERY_STREAM = 'history';
    process.env.ANALYTICS_MANIFEST = JSON.stringify(manifest);
    process.env.ANALYTICS_OMIT_FIELDS = '[]';
    send.mockResolvedValue({ RequestResponses: [{}] });

    const result = await handler({} as never)({ Records: [
      { eventID: 'ignored', eventName: 'INSERT', dynamodb: { SequenceNumber: '1', NewImage: { PK: { S: 'participant#one' }, SK: { S: 'LIST#participant' } } } },
      { eventID: 'event-2', eventName: 'INSERT', dynamodb: { SequenceNumber: '2', ApproximateCreationDateTime: 1735693200, NewImage: image('hourly', { name: 'Ada' }) } },
    ] });

    expect(result.batchItemFailures).toEqual([]);
    const command = send.mock.calls[1][0] as PutRecordBatchCommand;
    const event = JSON.parse((command.input as { Records: { Data: Buffer }[] }).Records[0].Data.toString());
    expect(event.path).toBe('entities/hourly/event_date=2025-01-01/event_hour=01');
  });

  test('writes canonical deletes with their before image', async () => {
    process.env.ANALYTICS_DELIVERY_STREAM = 'history';
    process.env.ANALYTICS_MANIFEST = JSON.stringify(manifest);
    process.env.ANALYTICS_OMIT_FIELDS = '[]';
    send.mockResolvedValue({ RequestResponses: [{}] });

    await handler({} as never)({ Records: [{ eventID: 'event-3', eventName: 'REMOVE', dynamodb: { SequenceNumber: '3', ApproximateCreationDateTime: 1735689600, OldImage: image('participant', { name: 'Ada' }) } }] });

    const command = send.mock.calls[2][0] as PutRecordBatchCommand;
    const event = JSON.parse((command.input as { Records: { Data: Buffer }[] }).Records[0].Data.toString());
    expect(event).toMatchObject({ operation: 'REMOVE' });
    expect(JSON.parse(event.before).data).toEqual({ name: 'Ada' });
    expect(event.after).toBeUndefined();
  });
});
