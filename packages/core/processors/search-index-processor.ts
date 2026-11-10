import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type { _Record as DynamoDBStreamEvent } from '@aws-sdk/client-dynamodb-streams';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import {
  type Entity as EntityType,
  indexedWords,
  searchConfigHash,
} from '@monorise/base';
import type { Context } from 'aws-lambda';
import { Entity } from '../data/Entity';
import type { DependencyContainer } from '../services/DependencyContainer';

/**
 * Keeps an entity's search rows in line with its data, from a stream record
 * of its #METADATA# row. Only words that came or went are written: the
 * replication processor refreshes the data on the rest, and deletes them all
 * when the entity is removed.
 */
export async function syncSearchIndex(
  container: DependencyContainer,
  record: DynamoDBStreamEvent,
): Promise<void> {
  if (record.eventName !== 'INSERT' && record.eventName !== 'MODIFY') return;

  const newImage = record.dynamodb?.NewImage as
    | Record<string, AttributeValue>
    | undefined;
  if (
    !newImage?.SK?.S?.startsWith('#METADATA#') ||
    newImage.PK?.S?.startsWith('MUTUAL#')
  ) {
    return;
  }

  const entity = Entity.fromItem(newImage);
  const config = container.searchRepository.searchConfig(entity.entityType);
  if (!config) return;

  const oldImage = record.dynamodb?.OldImage as
    | Record<string, AttributeValue>
    | undefined;
  const previous = oldImage
    ? indexedWords(unmarshall(oldImage).data, config)
    : [];
  const words = indexedWords(entity.data as Record<string, unknown>, config);

  await container.searchRepository.writeRows(
    entity,
    words.filter((word) => !previous.includes(word)),
    previous.filter((word) => !words.includes(word)),
  );
}

export type SearchReindexEvent =
  // Sent on deploy: starts a reindex for each indexed type whose index wasn't
  // built for its current config, or for every indexed type with `force`.
  | { action: 'start'; force?: boolean }
  | {
      action: 'reindex';
      entityType: EntityType;
      configHash: string;
      lastKey?: string;
      // Times the page at `lastKey` has failed in a row.
      failures?: number;
    };

// Leave time to hand the rest over before the Lambda times out.
const HANDOVER_MS = 2 * 60 * 1000;
const PAGE_SIZE = 100;
// Entities reindexed at once. Each makes up to `maxWords` writes, so this
// bounds the burst the table sees.
const CONCURRENCY = 25;
// A page may fail this many times in a row, retried after a growing wait,
// before the reindex gives up and fails.
const MAX_FAILURES = 3;
const RETRY_WAIT_MS = 5000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let lambdaClient: LambdaClient | undefined;
const invokeSelf = async (event: SearchReindexEvent) => {
  lambdaClient ??= new LambdaClient();
  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify(event)),
    }),
  );
};

/**
 * Builds the search index for entities that existed before their `search`
 * config did, or before it changed. Search scans every entity until a type
 * is marked ready. Runs as one invocation per entity type, each handing the
 * rest of its type to a new invocation when it runs low on time. Rows are
 * only listed here: each entity is read again before its rows are written.
 *
 * A page that fails is retried by a new invocation from the same page. Once
 * it has failed MAX_FAILURES times in a row the invocation throws, so the
 * function's error alarm fires; the type keeps scanning until a forced start
 * or a config change rebuilds it.
 */
export const handler =
  (container: DependencyContainer, invoke = invokeSelf, pause = wait) =>
  async (
    event: SearchReindexEvent,
    context?: Pick<Context, 'getRemainingTimeInMillis'>,
  ) => {
    const { searchRepository, entityRepository } = container;

    if (event.action === 'start') {
      const indexed = searchRepository.indexedEntityTypes();

      // A type without `search` isn't indexed as it changes, so if it's
      // indexed again later, its index has to be rebuilt in full.
      const entityTypes = Object.keys(
        container.config.EntityConfig,
      ) as unknown as EntityType[];
      for (const entityType of entityTypes) {
        if (!indexed.includes(entityType)) {
          await searchRepository.clearIndexState(entityType);
        }
      }

      for (const entityType of indexed) {
        const config = searchRepository.searchConfig(entityType);
        if (!config) continue;

        const configHash = searchConfigHash(config);
        const state = await searchRepository.getIndexState(entityType);
        if (
          !event.force &&
          state?.state === 'ready' &&
          state.configHash === configHash
        ) {
          continue;
        }

        await searchRepository.markIndexBuilding(entityType, configHash);
        await invoke({ action: 'reindex', entityType, configHash });
      }
      return;
    }

    const { entityType, configHash } = event;
    const config = searchRepository.searchConfig(entityType);
    if (!config || searchConfigHash(config) !== configHash) {
      // The config changed since this reindex started; the reindex for the
      // new config replaces it.
      console.log('[SEARCH_REINDEX] superseded, stopping', { entityType });
      return;
    }

    let lastKey = event.lastKey;
    let failures = event.failures ?? 0;
    do {
      try {
        const page = await entityRepository.listEntities({
          entityType,
          limit: PAGE_SIZE,
          options: { lastKey },
        });
        for (let i = 0; i < page.items.length; i += CONCURRENCY) {
          await Promise.all(
            page.items
              .slice(i, i + CONCURRENCY)
              .map((entity) =>
                searchRepository.reindexEntity(
                  entityType,
                  entity.entityId as string,
                  config,
                ),
              ),
          );
        }
        lastKey = page.lastKey;
        failures = 0;
      } catch (err) {
        failures++;
        if (failures >= MAX_FAILURES) {
          console.error(
            '[SEARCH_REINDEX] giving up: search scans until rebuilt',
            {
              entityType,
              lastKey,
              failures,
              err,
            },
          );
          throw err;
        }

        console.warn('[SEARCH_REINDEX] page failed, retrying', {
          entityType,
          lastKey,
          failures,
          err,
        });
        // Retried in a new invocation, so the retry gets a full timeout.
        await pause(RETRY_WAIT_MS * 2 ** (failures - 1));
        await invoke({
          action: 'reindex',
          entityType,
          configHash,
          lastKey,
          failures,
        });
        return;
      }

      if (
        lastKey &&
        context &&
        context.getRemainingTimeInMillis() < HANDOVER_MS
      ) {
        await invoke({ action: 'reindex', entityType, configHash, lastKey });
        return;
      }
    } while (lastKey);

    const ready = await searchRepository.markIndexReady(entityType, configHash);
    console.log('[SEARCH_REINDEX] done', { entityType, ready });
  };
