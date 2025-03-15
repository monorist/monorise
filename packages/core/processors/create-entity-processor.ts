import type { Entity } from '@monorise/base';
import type { SQSBatchItemFailure, SQSEvent } from 'aws-lambda';
import { StandardError } from '../errors/standard-error';
import { parseSQSBusEvent } from '../helpers/event';
import { DependencyContainer } from '../services/DependencyContainer';

const container = new DependencyContainer();

type EventDetailBody = {
  entityType: Entity;
  entityId?: string;
  entityPayload: Record<string, any>;
  accountId?: string;
  options: {
    createAndUpdateDatetime?: string;
    mutualId?: string;
  };
};

export const handler = async (ev: SQSEvent) => {
  const { entityService } = container;
  const batchItemFailures: SQSBatchItemFailure[] = [];

  for (const record of ev.Records) {
    const errorContext: Record<string, unknown> = {};
    const body = parseSQSBusEvent<EventDetailBody>(record.body);
    const { detail } = body;
    const { entityType, entityId, entityPayload, accountId, options } = detail;
    errorContext.body = body;

    try {
      await entityService.createEntity({
        entityType,
        entityId,
        entityPayload,
        accountId,
        options,
      });
    } catch (err) {
      console.error(
        '=====CREATE_ENTITY_PROCESSOR_ERROR=====',
        err,
        JSON.stringify({ errorContext }, null, 2),
      );

      if (err instanceof StandardError && err.code === 'INVALID_ENTITY_TYPE') {
        continue; // do not retry
      }

      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};
