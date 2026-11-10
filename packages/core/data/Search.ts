import {
  type AttributeValue,
  ConditionalCheckFailedException,
  type DynamoDB,
  type WriteRequest,
} from '@aws-sdk/client-dynamodb';
import {
  type Entity as EntityType,
  type ResolvedSearchConfig,
  type SearchSettings,
  type createEntityConfig,
  indexedWords,
  matchesSearch,
  planSearch,
  resolveSearchConfig,
  searchConfigHash,
} from '@monorise/base';
import { ENTITY_REPLICATION_INDEX } from '../configs/service.config';
import { Entity, type EntityRepository } from './Entity';

// One marker row per entity type records which config its index was built
// for. Its SK isn't #METADATA#, so stream processors skip it.
const INDEX_STATE_PK = '#SEARCH#';

const BATCH_WRITE_LIMIT = 25;

/**
 * Word index for entities configured with `search`. Each word an entity is
 * indexed by is a copy of the entity at PK `SEARCH#<type>`, SK
 * `<word>#<entityId>`, with R1PK set to the entity so the replication
 * processor keeps its data current and removes it with the entity.
 */
export class SearchRepository {
  // Entity types whose index matched the config, once seen. The config is
  // fixed for the life of a Lambda instance, so this never goes stale.
  private readyTypes = new Set<string>();

  constructor(
    private readonly EntityConfig: Record<
      EntityType,
      ReturnType<typeof createEntityConfig>
    >,
    private readonly TABLE_NAME: string,
    private readonly dynamodbClient: DynamoDB,
    private readonly entityRepository: EntityRepository,
    private readonly searchDefaults?: SearchSettings,
  ) {}

  /** The resolved `search` config, or undefined if the type isn't indexed. */
  searchConfig(entityType: EntityType): ResolvedSearchConfig | undefined {
    const search = this.EntityConfig[entityType]?.search;
    return search
      ? resolveSearchConfig(search, this.searchDefaults)
      : undefined;
  }

  indexedEntityTypes(): EntityType[] {
    return (Object.keys(this.EntityConfig) as unknown as EntityType[]).filter(
      (entityType) => this.EntityConfig[entityType]?.search,
    );
  }

  private rowKeys(entityType: EntityType, entityId: string, word: string) {
    return {
      PK: { S: `SEARCH#${entityType}` },
      SK: { S: `${word}#${entityId}` },
    };
  }

  private searchRow<T extends EntityType>(entity: Entity<T>, word: string) {
    return {
      ...entity.toItem(),
      ...this.rowKeys(entity.entityType, entity.entityId as string, word),
      R1PK: entity.keys().PK,
      R1SK: { S: `SEARCH#${word}` },
    };
  }

  /** Puts a row for each word in `add` and deletes the rows in `remove`. */
  async writeRows<T extends EntityType>(
    entity: Entity<T>,
    add: string[],
    remove: string[],
  ): Promise<void> {
    const entityId = entity.entityId as string;
    const requests: WriteRequest[] = [
      ...add.map((word) => ({
        PutRequest: { Item: this.searchRow(entity, word) },
      })),
      ...remove.map((word) => ({
        DeleteRequest: {
          Key: this.rowKeys(entity.entityType, entityId, word),
        },
      })),
    ];

    for (let i = 0; i < requests.length; i += BATCH_WRITE_LIMIT) {
      let batch = requests.slice(i, i + BATCH_WRITE_LIMIT);
      for (let attempt = 0; batch.length; attempt++) {
        if (attempt > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(1000, 50 * 2 ** attempt)),
          );
        }
        const resp = await this.dynamodbClient.batchWriteItem({
          RequestItems: { [this.TABLE_NAME]: batch },
        });
        batch = resp.UnprocessedItems?.[this.TABLE_NAME] ?? [];
        if (batch.length && attempt === 8) {
          throw new Error(
            `Search index: ${batch.length} writes still unprocessed for ${entity.entityType}#${entityId}`,
          );
        }
      }
    }
  }

  /** The words an entity currently has rows for, read from the GSI. */
  async existingWords(
    entityType: EntityType,
    entityId: string,
  ): Promise<string[]> {
    const words: string[] = [];
    let lastKey: Record<string, AttributeValue> | undefined;
    do {
      const resp = await this.dynamodbClient.query({
        TableName: this.TABLE_NAME,
        IndexName: ENTITY_REPLICATION_INDEX,
        KeyConditionExpression: '#R1PK = :R1PK and begins_with(#R1SK, :R1SK)',
        ExpressionAttributeNames: { '#R1PK': 'R1PK', '#R1SK': 'R1SK' },
        ExpressionAttributeValues: {
          ':R1PK': { S: `${entityType}#${entityId}` },
          ':R1SK': { S: 'SEARCH#' },
        },
        ExclusiveStartKey: lastKey,
      });
      for (const item of resp.Items ?? []) {
        const r1sk = item.R1SK?.S;
        if (r1sk) words.push(r1sk.slice('SEARCH#'.length));
      }
      lastKey = resp.LastEvaluatedKey;
    } while (lastKey);

    return words;
  }

  async getIndexState(
    entityType: EntityType,
  ): Promise<{ state?: string; configHash?: string } | undefined> {
    const resp = await this.dynamodbClient.getItem({
      TableName: this.TABLE_NAME,
      Key: { PK: { S: INDEX_STATE_PK }, SK: { S: `${entityType}` } },
    });
    if (!resp.Item) return undefined;

    return {
      state: resp.Item.state?.S,
      configHash: resp.Item.configHash?.S,
    };
  }

  async markIndexBuilding(
    entityType: EntityType,
    configHash: string,
  ): Promise<void> {
    await this.dynamodbClient.putItem({
      TableName: this.TABLE_NAME,
      Item: {
        PK: { S: INDEX_STATE_PK },
        SK: { S: `${entityType}` },
        state: { S: 'building' },
        configHash: { S: configHash },
        updatedAt: { S: new Date().toISOString() },
      },
    });
  }

  /**
   * Marks the index ready, unless a newer reindex has taken over since: its
   * config hash replaces this one when it starts.
   */
  async markIndexReady(
    entityType: EntityType,
    configHash: string,
  ): Promise<boolean> {
    try {
      await this.dynamodbClient.updateItem({
        TableName: this.TABLE_NAME,
        Key: { PK: { S: INDEX_STATE_PK }, SK: { S: `${entityType}` } },
        UpdateExpression: 'SET #state = :ready, #updatedAt = :now',
        ConditionExpression: '#configHash = :configHash',
        ExpressionAttributeNames: {
          '#state': 'state',
          '#updatedAt': 'updatedAt',
          '#configHash': 'configHash',
        },
        ExpressionAttributeValues: {
          ':ready': { S: 'ready' },
          ':now': { S: new Date().toISOString() },
          ':configHash': { S: configHash },
        },
      });
      return true;
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) return false;
      throw err;
    }
  }

  /** Whether the index was fully built for the current config. */
  async isIndexReady(
    entityType: EntityType,
    config: ResolvedSearchConfig,
  ): Promise<boolean> {
    if (this.readyTypes.has(`${entityType}`)) return true;

    const state = await this.getIndexState(entityType);
    const ready =
      state?.state === 'ready' && state.configHash === searchConfigHash(config);
    if (ready) this.readyTypes.add(`${entityType}`);

    return ready;
  }

  /** Deletes the marker, so the next reindex rebuilds the type in full. */
  async clearIndexState(entityType: EntityType): Promise<void> {
    await this.dynamodbClient.deleteItem({
      TableName: this.TABLE_NAME,
      Key: { PK: { S: INDEX_STATE_PK }, SK: { S: `${entityType}` } },
    });
  }

  /**
   * Brings one entity's rows in line with its current data and config. It
   * runs alongside the stream, which may write a newer version of the same
   * rows, so each write only goes through over an older copy.
   */
  async reindexEntity(
    entityType: EntityType,
    entityId: string,
    config: ResolvedSearchConfig,
  ): Promise<void> {
    const resp = await this.dynamodbClient.getItem({
      TableName: this.TABLE_NAME,
      Key: new Entity(entityType, entityId).keys(),
      ConsistentRead: true,
    });
    // Deleted since it was listed: removing it removes its rows.
    if (!resp.Item) return;

    const entity = Entity.fromItem(resp.Item);
    const existing = await this.existingWords(entityType, entityId);
    const words = indexedWords(entity.data as Record<string, unknown>, config);
    const notNewer = {
      ExpressionAttributeNames: { '#updatedAt': 'updatedAt' },
      ExpressionAttributeValues: {
        ':updatedAt': { S: entity.updatedAt as string },
      },
    };
    const ignoreNewer = (err: unknown) => {
      if (!(err instanceof ConditionalCheckFailedException)) throw err;
    };

    await Promise.all([
      ...words
        .filter((word) => !existing.includes(word))
        .map((word) =>
          this.dynamodbClient
            .putItem({
              TableName: this.TABLE_NAME,
              Item: this.searchRow(entity, word),
              ConditionExpression:
                'attribute_not_exists(PK) OR #updatedAt < :updatedAt',
              ...notNewer,
            })
            .catch(ignoreNewer),
        ),
      ...existing
        .filter((word) => !words.includes(word))
        .map((word) =>
          this.dynamodbClient
            .deleteItem({
              TableName: this.TABLE_NAME,
              Key: this.rowKeys(entityType, entityId, word),
              ConditionExpression: '#updatedAt <= :updatedAt',
              ...notNewer,
            })
            .catch(ignoreNewer),
        ),
    ]);
  }

  private async lookUp<T extends EntityType>(
    entityType: T,
    anchor: string,
  ): Promise<Entity<T>[]> {
    const items: Record<string, AttributeValue>[] = [];
    let lastKey: Record<string, AttributeValue> | undefined;
    do {
      const resp = await this.dynamodbClient.query({
        TableName: this.TABLE_NAME,
        KeyConditionExpression: '#PK = :PK and begins_with(#SK, :SK)',
        ExpressionAttributeNames: { '#PK': 'PK', '#SK': 'SK' },
        ExpressionAttributeValues: {
          ':PK': { S: `SEARCH#${entityType}` },
          ':SK': { S: anchor },
        },
        ExclusiveStartKey: lastKey,
      });
      items.push(...(resp.Items ?? []));
      lastKey = resp.LastEvaluatedKey;
    } while (lastKey);

    return items.map(Entity.fromItem<T>);
  }

  /**
   * Every entity matching `query`, newest first. Reads the rows of the
   * query's longest word, or scans every entity while the index is still
   * being built for the current config. Both give the same matches.
   *
   * There's no `totalCount`: counting every entity of the type would take
   * the scan the index avoids. `filteredCount` is the number of matches.
   */
  async searchEntities<T extends EntityType>(
    entityType: T,
    query: string,
  ): Promise<{
    items: Entity<T>[];
    totalCount?: undefined;
    filteredCount: number;
  }> {
    const config = this.searchConfig(entityType);
    const plan = config && planSearch(query, config.ignoreWords);
    if (!config || !plan?.anchor) {
      return { items: [], filteredCount: 0 };
    }

    const candidates = (await this.isIndexReady(entityType, config))
      ? await this.lookUp(entityType, plan.anchor)
      : (await this.entityRepository.listEntities<T>({ entityType })).items;

    const seen = new Set<string>();
    const items: Entity<T>[] = [];
    for (const entity of candidates) {
      const entityId = entity.entityId as string;
      if (seen.has(entityId)) continue;
      seen.add(entityId);
      if (matchesSearch(entity.data as Record<string, unknown>, plan, config)) {
        items.push(entity);
      }
    }
    // The order the list endpoint (and the scan) returns: newest ID first.
    items.sort((a, b) =>
      (a.entityId as string) < (b.entityId as string) ? 1 : -1,
    );

    return { items, filteredCount: items.length };
  }
}
