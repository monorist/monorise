import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import { EventBus } from 'sst/node/event-bus';
import { EVENT, type EventDetail } from '../types/event';

const eventBridge = new EventBridgeClient();

type PublishEventProps<T> = {
  payload: T;
  event: EventDetail;
};

type ParsedSQSBusEvent<T = Record<string, any>> = {
  event: EventDetail;
  detail: T;
};

export function parseSQSBusEvent<T>(
  evRecordBody: string,
): ParsedSQSBusEvent<T> {
  const body = JSON.parse(evRecordBody);
  return {
    ...body,
    detail: body.detail,
    event: {
      Source: body.source,
      DetailType: body['detail-type'],
    },
  };
}

export async function publishEvent<T extends Record<string, any>>({
  payload,
  event,
}: PublishEventProps<T>): Promise<void> {
  const params = {
    Entries: [
      {
        ...event,
        Detail: JSON.stringify(payload),
        EventBusName: EventBus['infra-event-bus'].eventBusName,
      },
    ],
  };

  await eventBridge.send(new PutEventsCommand(params));
}

type PublishErrorEventPayload = {
  id: string;
  serviceName: string;
  method: string;
  path: string;
  body?: Record<string, any>;
  error: Error;
};

export async function publishErrorEvent({
  id,
  serviceName,
  method,
  path,
  body,
  error,
}: PublishErrorEventPayload) {
  await publishEvent({
    event: EVENT.GENERAL.ENDPOINT_ERROR,
    payload: {
      id,
      serviceName,
      method,
      path,
      ...(body ? { requestBody: body } : {}),
      error: {
        name: error.name,
        message: error.message,
        // @ts-ignore
        cause: error.cause,
        stack: error.stack,
      },
    },
  });
}
