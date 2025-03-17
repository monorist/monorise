import {
  type AttributeValue,
  ConditionalCheckFailedException,
  type DynamoDB,
  type QueryCommandInput,
  type TransactWriteItem,
  type UpdateItemCommandInput,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import type { EntitySchemaMap, Entity as EntityType } from '@monorise/base';
import { ulid } from 'ulid';
// import {
//   EmailAuthEnabledEntities,
//   EntityConfig,
// } from '#/lambda-layer/monorise';
import { StandardError } from '../errors/standard-error';
import type { ProjectionExpressionValues } from './ProjectionExpression';
import { Item } from './abstract/Item.base';
import { Repository } from './abstract/Repository.base';

export class Entity<T extends EntityType> extends Item {
  public fullId: string;

  constructor(
    public entityType: T,
    public entityId?: string,
    public data: Partial<EntitySchemaMap[T]> = {},
    private _createdAt?: Date,
    private _updatedAt?: Date,
  ) {
    super();
    this.fullId = this.pk;
  }

  static fromItem<T extends EntityType>(
    item?: Record<string, AttributeValue>,
  ): Entity<T> {
    if (!item)
      throw new StandardError('ENTITY_IS_UNDEFINED', 'Entity item empty');

    const parsedItem = unmarshall(item);

    return new Entity<T>(
      parsedItem.entityType,
      parsedItem.entityId,
      parsedItem.data,
      parsedItem.createdAt ? new Date(parsedItem.createdAt) : undefined,
      parsedItem.updatedAt ? new Date(parsedItem.updatedAt) : undefined,
    );
  }

  get pk(): string {
    return `${this.entityType}#${this.entityId}`;
  }

  get sk(): string {
    return '#METADATA#';
  }

  get listActionKey(): string {
    return `LIST#${this.entityType}`;
  }

  get emailKeys(): Record<string, AttributeValue> {
    return {
      PK: {
        S: `EMAIL#${(this.data as Partial<EntitySchemaMap[T]> & { email: string }).email}`,
      },
      SK: {
        S: `${this.entityType}#${this.entityId}`,
      },
    };
  }

  get createdAt(): string | undefined {
    return this._createdAt?.toISOString();
  }

  get updatedAt(): string | undefined {
    return this._updatedAt?.toISOString();
  }

  toItem(): Record<string, AttributeValue> {
    return {
      ...marshall(this.toJSON(), { removeUndefinedValues: true }),
      ...this.keys(),
    };
  }

  toJSON(): Record<string, unknown> {
    return {
      entityType: this.entityType,
      entityId: this.entityId,
      data: this.data,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

export class EntityRepository extends Repository {
  constructor(
    private EntityConfig: any,
    private readonly TABLE_NAME: string,
    private readonly dynamodbClient: DynamoDB,
  ) {
    super();
  }

  async listEntities<T extends EntityType>({
    entityType,
    limit, // if this is not set, it will return all items
    between,
    options = {},
  }: {
    entityType: T;
    limit?: number;
    between?: {
      start: string;
      end: string;
    };
    options?: {
      lastKey?: Record<string, AttributeValue>;
      ProjectionExpression?: ProjectionExpressionValues;
    };
  }): Promise<{
    items: Entity<T>[];
    totalCount?: number;
    lastKey?: Record<string, AttributeValue>;
  }> {
    const entity = new Entity(entityType);
    // when query for records that SK are between provided start and end
    const expression: Pick<
      QueryCommandInput,
      | 'KeyConditionExpression'
      | 'ExpressionAttributeNames'
      | 'ExpressionAttributeValues'
    > = between
      ? {
          KeyConditionExpression:
            '#PK = :PK and #SK between :SKStart and :SKEnd',
          ExpressionAttributeNames: {
            '#PK': 'PK',
            '#SK': 'SK',
          },
          ExpressionAttributeValues: {
            ':PK': {
              S: entity.listActionKey,
            },
            ':SKStart': {
              S: `${entityType}#${between.start}`,
            },
            ':SKEnd': {
              S: `${entityType}#${between.end}`,
            },
          },
        }
      : {
          KeyConditionExpression: '#PK = :PK',
          ExpressionAttributeNames: {
            '#PK': 'PK',
          },
          ExpressionAttributeValues: {
            ':PK': {
              S: entity.listActionKey,
            },
          },
        };

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

  async getEntity<T extends EntityType>(
    entityType: T,
    entityId: string,
  ): Promise<Entity<T>> {
    const entity = new Entity(entityType, entityId);
    const resp = await this.dynamodbClient.getItem({
      TableName: this.TABLE_NAME,
      Key: entity.keys(),
    });

    return Entity.fromItem(resp.Item);
  }

  async getEntityByEmail<T extends EntityType>(
    entityType: T,
    email: string,
  ): Promise<Entity<T>> {
    const resp = await this.dynamodbClient.query({
      TableName: this.TABLE_NAME,
      KeyConditionExpression: '#PK = :PK and begins_with(#SK, :SK)',
      ExpressionAttributeNames: {
        '#PK': 'PK',
        '#SK': 'SK',
      },
      ExpressionAttributeValues: {
        ':PK': { S: `EMAIL#${email}` },
        ':SK': { S: entityType as unknown as string },
      },
    });

    return Entity.fromItem(resp.Items?.[0]);
  }

  async getEmailAvailability<T extends EntityType>(
    entityType: T,
    email: string,
  ): Promise<void> {
    const resp = await this.dynamodbClient.query({
      TableName: this.TABLE_NAME,
      KeyConditionExpression: '#PK = :PK and begins_with(#SK, :SK)',
      ExpressionAttributeNames: {
        '#PK': 'PK',
        '#SK': 'SK',
      },
      ExpressionAttributeValues: {
        ':PK': { S: `EMAIL#${email}` },
        ':SK': { S: entityType as unknown as string },
      },
    });

    if (resp.Items?.[0]) {
      throw new StandardError('EMAIL_EXISTS', 'Email already exists');
    }

    return;
  }

  createEntityTransactItems<T extends EntityType>(
    entity: Entity<T>,
    opts?: {
      mutualId?: string;
    },
  ): TransactWriteItem[] {
    const TransactItems: TransactWriteItem[] = [
      {
        Put: {
          TableName: this.TABLE_NAME,
          ConditionExpression: 'attribute_not_exists(PK)',
          Item: {
            ...entity.toItem(),
            ...(opts?.mutualId && {
              R2PK: { S: opts.mutualId },
              R2SK: { S: entity.pk },
            }),
          },
        },
      },
      {
        Put: {
          TableName: this.TABLE_NAME,
          ConditionExpression: 'attribute_not_exists(PK)',
          Item: {
            ...entity.toItem(),
            PK: { S: entity.listActionKey },
            SK: entity.keys().PK,
            R1PK: entity.keys().PK,
            R1SK: { S: entity.listActionKey },
          },
        },
      },
    ];

    // currently when detected it's an account, create email record
    // TODO: Future improvement, if we introduce multiple ways to register/login,
    // here we should also check if entity has the respective auth method defined
    // in the config file
    // if (EmailAuthEnabledEntities.includes(entity.entityType)) {
    //   TransactItems.push({
    //     Put: {
    //       TableName: this.TABLE_NAME,
    //       ConditionExpression: 'attribute_not_exists(PK)',
    //       Item: {
    //         ...entity.toItem(),
    //         ...entity.emailKeys,
    //         R1PK: entity.emailKeys.SK,
    //         R1SK: entity.emailKeys.PK,
    //       },
    //     },
    //   });
    // }

    return TransactItems;
  }

  async createEntity<T extends EntityType>(
    entityType: T,
    entityPayload: EntitySchemaMap[T],
    entityId?: string,
    opts?: {
      createAndUpdateDatetime?: Date;
      mutualId?: string;
    },
  ): Promise<Entity<T>> {
    const currentDatetime = opts?.createAndUpdateDatetime ?? new Date();
    const entity = new Entity<T>(
      entityType,
      entityId || ulid(),
      entityPayload,
      currentDatetime,
      currentDatetime,
    );
    const TransactItems = this.createEntityTransactItems<T>(entity, {
      mutualId: opts?.mutualId,
    });

    await this.dynamodbClient.transactWriteItems({ TransactItems });

    return entity;
  }

  async upsertEntity<T extends EntityType>(
    entityType: T,
    entityId: string,
    payload: Partial<EntitySchemaMap[T]>,
  ): Promise<Entity<T>> {
    const toUpdateExpressions = this.toUpdate({
      entityType,
      entityId,
      data: payload,
    });
    const params: UpdateItemCommandInput = {
      TableName: this.TABLE_NAME,
      ReturnValues: 'ALL_NEW',
      Key: new Entity(entityType, entityId).keys(),
      UpdateExpression: toUpdateExpressions.UpdateExpression,
      ExpressionAttributeNames: {
        ...toUpdateExpressions.ExpressionAttributeNames,
      },
      ExpressionAttributeValues: {
        ...toUpdateExpressions.ExpressionAttributeValues,
      },
    };

    const resp = await this.dynamodbClient.updateItem(params);
    const updatedEntity = Entity.fromItem<T>(resp.Attributes);
    return updatedEntity;
  }

  async updateEntity<T extends EntityType>(
    entityType: T,
    entityId: string,
    toUpdate: {
      data: Partial<EntitySchemaMap[T]>;
      updatedAt?: string;
    },
    opts?: {
      ConditionExpression: string;
      ExpressionAttributeNames: Record<string, string>;
      ExpressionAttributeValues: Record<string, AttributeValue>;
    },
  ): Promise<Entity<T>> {
    try {
      const currentDatetime = new Date().toISOString();
      const toUpdateExpressions = this.toUpdate({
        updatedAt: currentDatetime,
        ...toUpdate,
      });
      const params: UpdateItemCommandInput = {
        TableName: this.TABLE_NAME,
        ReturnValues: 'ALL_NEW',
        Key: new Entity(entityType, entityId).keys(),
        ConditionExpression:
          opts?.ConditionExpression || 'attribute_exists(PK)',
        UpdateExpression: toUpdateExpressions.UpdateExpression,
        ExpressionAttributeNames: {
          ...toUpdateExpressions.ExpressionAttributeNames,
          ...opts?.ExpressionAttributeNames,
        },
        ExpressionAttributeValues: {
          ...toUpdateExpressions.ExpressionAttributeValues,
          ...opts?.ExpressionAttributeValues,
        },
      };

      const resp = await this.dynamodbClient.updateItem(params);
      const updatedEntity = Entity.fromItem<T>(resp.Attributes);
      return updatedEntity;
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        throw new StandardError('ENTITY_NOT_FOUND', 'Entity not found', err, {
          entityId,
          toUpdate,
        });
      }

      throw err;
    }
  }

  async deleteEntity<T extends EntityType>(
    entityType: T,
    entityId: string,
  ): Promise<void> {
    try {
      const entity = new Entity(entityType, entityId);

      await this.dynamodbClient.deleteItem({
        TableName: this.TABLE_NAME,
        Key: entity.keys(),
        ConditionExpression: 'attribute_exists(PK)',
      });
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        throw new StandardError('ENTITY_NOT_FOUND', 'Entity not found', err, {
          entityId,
        });
      }

      throw err;
    }
  }

  async queryEntities<T extends EntityType>(
    entityType: T,
    query: string,
  ): Promise<{
    items: Entity<T>[];
    totalCount?: number;
    filteredCount?: number;
  }> {
    const results: { items: Entity<T>[]; totalCount: number } = {
      items: [],
      totalCount: 0,
    };
    // let regex be empty if its invalid (eg. +)
    let queryRegex = /(?:)/;
    try {
      queryRegex = new RegExp(query.toLowerCase());
    } catch (err) {
      return results;
    }

    const listResults = await this.listEntities<T>({
      entityType,
    });
    results.items.push(...listResults.items);
    results.totalCount += listResults.totalCount || 0;

    const filteredItems: Entity<T>[] = [];

    const { searchableFields } = this.EntityConfig[entityType];

    for (const item of results.items) {
      const searchTerm = (searchableFields ?? [])
        .map((field) =>
          (item.data as Record<string, any>)[field]?.toLowerCase(),
        )
        .join(' ');
      const isMatched = queryRegex.test(searchTerm);
      if (isMatched) {
        filteredItems.push(item);
      }
    }

    return {
      items: filteredItems,
      totalCount: results.totalCount,
      filteredCount: filteredItems.length,
    };
  }
}
