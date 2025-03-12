import type {
  AttributeValue,
  DynamoDB,
  QueryCommandInput,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import type { EntitySchemaMap, Entity as EntityType } from '@monorise/base';
import { StandardError } from '#/errors/standard-error';
import { Entity } from './Entity';
import type { ProjectionExpressionValues } from './ProjectionExpression';
import { Repository } from './abstract/Repository.base';

export class TaggedEntity<T extends EntityType> extends Entity<T> {
  public tagName: string;
  public group?: string;
  public sortValue?: string;

  constructor({
    tagName,
    group,
    sortValue,
    entityType,
    entityId,
    data,
    createdAt,
    updatedAt,
  }: {
    tagName: string;
    group?: string;
    sortValue?: string;
    entityType: T;
    entityId: string;
    data?: Partial<EntitySchemaMap[T]>;
    createdAt?: Date;
    updatedAt?: Date;
  }) {
    super(entityType, entityId, data, createdAt, updatedAt);

    this.tagName = tagName;
    this.group = group;
    this.sortValue = sortValue;
  }

  static fromItem<T extends EntityType>(
    item?: Record<string, AttributeValue>,
  ): TaggedEntity<T> {
    if (!item) throw new StandardError('TAG_IS_UNDEFINED', 'Tag item empty');

    const parsedItem = unmarshall(item);

    return new TaggedEntity<T>({
      tagName: parsedItem.tagName,
      group: parsedItem.group,
      sortValue: parsedItem.sortValue,
      entityType: parsedItem.entityType,
      entityId: parsedItem.entityId,
      data: parsedItem.data,
      createdAt: parsedItem.createdAt
        ? new Date(parsedItem.createdAt)
        : undefined,
      updatedAt: parsedItem.updatedAt
        ? new Date(parsedItem.updatedAt)
        : undefined,
    });
  }

  get pk(): string {
    return `TAG#${this.entityType}#${this.tagName}${this.group ? `#${this.group}` : ''}`;
  }

  get sk(): string {
    return `${this.sortValue ? `${this.sortValue}#` : ''}${this.entityType}#${this.entityId}`;
  }

  reversedKeys(): Record<string, AttributeValue> {
    return {
      PK: { S: `${this.entityType}#${this.entityId}` },
      SK: {
        S: this.pk,
      },
    };
  }

  replicationKeys(): Record<string, AttributeValue> {
    const keys = this.reversedKeys();

    return {
      R1PK: keys.PK,
      R1SK: keys.SK,
    };
  }

  toItem(): Record<string, AttributeValue> {
    return {
      ...marshall(this.toJSON(), { removeUndefinedValues: true }),
      ...this.keys(),
    };
  }

  toJSON(): Record<string, unknown> {
    return {
      tagName: this.tagName,
      group: this.group,
      sortValue: this.sortValue,
      entityType: this.entityType,
      entityId: this.entityId,
      data: this.data,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

export class TagRepository extends Repository {
  constructor(
    private readonly TABLE_NAME: string,
    private readonly dynamodbClient: DynamoDB,
  ) {
    super();
  }

  async getExistingTags<T extends EntityType>({
    entityType,
    entityId,
    tagName,
  }: {
    entityType: T;
    entityId: string;
    tagName: string;
  }): Promise<TaggedEntity<T>[]> {
    const PK = `${entityType}#${entityId}`;
    const SK = `TAG#${entityType}#${tagName}`;

    const results = await this.dynamodbClient.query({
      TableName: this.TABLE_NAME,
      KeyConditionExpression: '#PK = :PK and begins_with(#SK, :SK)',
      ExpressionAttributeNames: {
        '#PK': 'PK',
        '#SK': 'SK',
      },
      ExpressionAttributeValues: {
        ':PK': { S: PK },
        ':SK': { S: SK },
      },
    });

    return (results.Items || []).map((item: any) => {
      return TaggedEntity.fromItem(item);
    });
  }

  async deleteTag({
    tagName,
    group,
    sortValue,
    entityType,
    entityId,
  }: {
    tagName: string;
    group?: string;
    sortValue?: string;
    entityType: EntityType;
    entityId: string;
  }): Promise<void> {
    const tag = new TaggedEntity({
      tagName,
      group,
      sortValue,
      entityType,
      entityId,
    });

    await Promise.all([
      this.dynamodbClient.deleteItem({
        TableName: this.TABLE_NAME,
        Key: tag.keys(),
      }),
      this.dynamodbClient.deleteItem({
        TableName: this.TABLE_NAME,
        Key: tag.reversedKeys(),
      }),
    ]);

    return;
  }

  async createTag<T extends EntityType>({
    tagName,
    group,
    sortValue,
    entity,
  }: {
    tagName: string;
    group?: string;
    sortValue?: string;
    entity: Entity<T>;
  }): Promise<TaggedEntity<T>> {
    if (!entity.entityId) {
      throw new StandardError(
        'ENTITY_ID_IS_UNDEFINED',
        'entityId is undefined',
      );
    }

    const tag = new TaggedEntity({
      tagName,
      group,
      sortValue,
      entityType: entity.entityType,
      entityId: entity.entityId,
      data: entity.data,
      createdAt: entity.createdAt ? new Date(entity.createdAt) : new Date(),
      updatedAt: entity.updatedAt ? new Date(entity.updatedAt) : new Date(),
    });

    await Promise.all([
      this.dynamodbClient.putItem({
        TableName: this.TABLE_NAME,
        Item: {
          ...tag.toItem(),
          ...tag.replicationKeys(),
        },
      }),
      this.dynamodbClient.putItem({
        TableName: this.TABLE_NAME,
        Item: {
          ...marshall(
            {
              tagName,
              group,
              sortValue,
            },
            { removeUndefinedValues: true },
          ),
          ...tag.reversedKeys(),
          ...tag.replicationKeys(),
        },
      }),
    ]);

    return tag;
  }

  async listTags<T extends EntityType>({
    entityType,
    tagName,
    limit, // if this is not set, it will return all items
    query,
    group,
    start,
    end,
    options = {},
  }: {
    entityType: T;
    tagName: string;
    limit?: number;
    start?: string;
    end?: string;
    query?: string;
    group?: string;
    options?: {
      lastKey?: Record<string, AttributeValue>;
      ProjectionExpression?: ProjectionExpressionValues;
    };
  }): Promise<{
    items: Entity<T>[];
    totalCount?: number;
    lastKey?: Record<string, AttributeValue>;
  }> {
    const errorContext: Record<string, unknown> = {
      entityType,
      tagName,
      limit,
      query,
      group,
      start,
      end,
      options,
    };

    const tag = new TaggedEntity({
      tagName,
      entityType,
      entityId: '',
      group,
    });

    let expression: Pick<
      QueryCommandInput,
      | 'KeyConditionExpression'
      | 'ExpressionAttributeNames'
      | 'ExpressionAttributeValues'
    > | null = null;

    if (query && !start && !end) {
      expression = {
        KeyConditionExpression: '#PK = :PK and begins_with(#SK, :SK)',
        ExpressionAttributeNames: {
          '#PK': 'PK',
          '#SK': 'SK',
        },
        ExpressionAttributeValues: {
          ':PK': {
            S: tag.pk,
          },
          ':SK': {
            S: `${query}#`,
          },
        },
      };
    } else if (start && end) {
      expression = {
        KeyConditionExpression: '#PK = :PK and #SK between :SKStart and :SKEnd',
        ExpressionAttributeNames: {
          '#PK': 'PK',
          '#SK': 'SK',
        },
        ExpressionAttributeValues: {
          ':PK': {
            S: tag.pk,
          },
          ':SKStart': {
            S: `${start}#`,
          },
          ':SKEnd': {
            S: `${end}#`,
          },
        },
      };
    } else if (start && !end) {
      expression = {
        KeyConditionExpression: '#PK = :PK and #SK >= :SK',
        ExpressionAttributeNames: {
          '#PK': 'PK',
          '#SK': 'SK',
        },
        ExpressionAttributeValues: {
          ':PK': {
            S: tag.pk,
          },
          ':SK': {
            S: `${start}#`,
          },
        },
      };
    } else if (!start && end) {
      expression = {
        KeyConditionExpression: '#PK = :PK and #SK <= :SK',
        ExpressionAttributeNames: {
          '#PK': 'PK',
          '#SK': 'SK',
        },
        ExpressionAttributeValues: {
          ':PK': {
            S: tag.pk,
          },
          ':SK': {
            S: `${end}#`,
          },
        },
      };
    } else if (group && !query && !start && !end) {
      expression = {
        KeyConditionExpression: '#PK = :PK',
        ExpressionAttributeNames: {
          '#PK': 'PK',
        },
        ExpressionAttributeValues: {
          ':PK': {
            S: tag.pk,
          },
        },
      };
    }

    if (!expression) {
      throw new StandardError(
        'INVALID_QUERY',
        'Invalid query. Please provide a valid query',
        null,
        errorContext,
      );
    }
    const defaultListQuery: QueryCommandInput = {
      TableName: this.TABLE_NAME,
      Limit: limit,
      ScanIndexForward: false,
      ProjectionExpression: options?.ProjectionExpression,
      ...expression,
    };

    let lastKey = options.lastKey;
    let items: Record<string, AttributeValue>[] = [];
    let remainingCount = limit ?? 0;
    do {
      const resp = await this.dynamodbClient.query({
        ...defaultListQuery,
        ...(remainingCount && { Limit: remainingCount }),
        ...(lastKey && {
          ExclusiveStartKey: lastKey,
        }),
      });
      items = items.concat(resp.Items ?? []);

      lastKey = resp.LastEvaluatedKey;

      if (limit) {
        remainingCount = remainingCount - (resp.Items?.length ?? 0);
      }
    } while (
      // limit is given, haven't reach limit, and there are still items to retrieve
      (limit && remainingCount && lastKey) ||
      // no limit is given and there are still items to retrieve
      (!limit && lastKey)
    );

    return {
      items: (items || []).map(Entity.fromItem<T>),
      totalCount: items.length,
      lastKey,
    };
  }

  async createLock({
    entityType,
    entityId,
  }: {
    entityType: EntityType;
    entityId: string;
  }): Promise<void> {
    const oneMinuteLater = Math.floor(new Date().getTime() / 1000 + 1 * 60);

    await this.dynamodbClient.putItem({
      TableName: this.TABLE_NAME,
      Item: {
        PK: { S: `TAG#${entityType}#${entityId}` },
        SK: { S: '#LOCK#' },
        expiresAt: {
          // auto delete lock after 1 minute
          N: `${oneMinuteLater}`,
        },
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    });

    return;
  }

  async deleteLock({
    entityType,
    entityId,
  }: {
    entityType: EntityType;
    entityId: string;
  }): Promise<void> {
    try {
      await this.dynamodbClient.deleteItem({
        TableName: this.TABLE_NAME,
        Key: {
          PK: { S: `TAG#${entityType}#${entityId}` },
          SK: { S: '#LOCK#' },
        },
      });

      return;
    } catch (error) {
      // if lock is not found, it's okay
    }
  }
}
