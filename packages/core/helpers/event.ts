import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import { CORE_EVENT_BUS } from '../configs/service.config';
import { EVENT, type EventDetail } from '../types/event';
import { currentApiKey } from './request-context';

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
}: PublishEventProps<T>) {
  // An event published while handling an API request records the key that
  // made it, so every change traces back to its caller. Processors publish
  // outside a request, and their events carry no key.
  const apiKey = currentApiKey();
  const params = {
    Entries: [
      {
        ...event,
        Detail: JSON.stringify(apiKey ? { ...payload, apiKey } : payload),
        EventBusName: CORE_EVENT_BUS,
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
