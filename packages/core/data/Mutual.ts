import {
  type AttributeValue,
  BatchStatementErrorCodeEnum,
  type DynamoDB,
  type QueryCommandInput,
  type TransactWriteItem,
  TransactionCanceledException,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import type { Entity, EntitySchemaMap } from '@monorise/base';
import { ulid } from 'ulid';
import type { DbUtils } from '../data/DbUtils';
import { StandardError, StandardErrorCode } from '../errors/standard-error';
import { fromLastKeyQuery } from '../helpers/fromLastKeyQuery';
import { sleep } from '../helpers/sleep';
import { toLastKeyResponse } from '../helpers/toLastKeyResponse';
import {
  PROJECTION_EXPRESSION,
  type ProjectionExpressionValues,
} from './ProjectionExpression';
import { Repository } from './abstract/Repository.base';

export class Mutual<
  B extends Entity,
  T extends Entity,
  M extends Record<string, unknown>,
> {
  constructor(
    public byEntityType: B,
    public byEntityId: string,
    public byData: Partial<EntitySchemaMap[B]> | Record<string, any>,
    public entityType: T,
    public entityId: string,
    public data: Partial<EntitySchemaMap[T]> | Record<string, any>,
    public mutualData: M,
    public mutualId?: string,
    private _createdAt?: Date,
    private _updatedAt?: Date,
    private _mutualUpdatedAt?: Date,
    private _expiresAt?: Date,
  ) {}

  static fromItem<
    B extends Entity,
    T extends Entity,
    M extends Record<string, unknown>,
  >(item?: Record<string, AttributeValue>): Mutual<B, T, M> {
    if (!item)
      throw new StandardError(
        StandardErrorCode.MUTUAL_IS_UNDEFINED,
        'Mutual item empty',
      );

    const parsedItem = unmarshall(item);

    return new Mutual<B, T, M>(
      parsedItem.byEntityType,
      parsedItem.byEntityId,
      parsedItem.byData,
      parsedItem.entityType,
      parsedItem.entityId,
      parsedItem.data,
      parsedItem.mutualData,
      parsedItem.mutualId,
      parsedItem.createdAt ? new Date(parsedItem.createdAt) : undefined,
      parsedItem.updatedAt ? new Date(parsedItem.updatedAt) : undefined,
      parsedItem.mutualUpdatedAt
        ? new Date(parsedItem.mutualUpdatedAt)
        : undefined,
      parsedItem.expiresAt ? new Date(parsedItem.expiresAt) : undefined,
    );
  }

  public mainKeys(): Record<string, AttributeValue> {
    return {
      PK: { S: this.mainPk },
      SK: { S: this.mainSk },
    };
  }

  public subKeys(): Record<string, AttributeValue> {
    return {
      PK: { S: this.byFullEntityId },
      SK: { S: this.fullEntityId },
    };
  }

  get byFullEntityId(): string {
    return `${this.byEntityType}#${this.byEntityId}`;
  }

  get fullEntityId(): string {
    return `${this.entityType}#${this.entityId}`;
  }

  get listEntitySK(): string {
    return this.entityType as unknown as string;
  }

  get mainPk(): string {
    return `MUTUAL#${this.mutualId}`;
  }

  get mainSk(): string {
    return '#METADATA#';
  }

  get createdAt(): string | undefined {
    return this._createdAt?.toISOString();
  }

  get updatedAt(): string | undefined {
    return this._updatedAt?.toISOString();
  }

  get mutualUpdatedAt(): string | undefined {
    return this._mutualUpdatedAt?.toISOString();
  }

  get expiresAt(): string | undefined {
    return this._expiresAt?.toISOString();
  }

  toItem(): Record<string, AttributeValue> {
    return {
      ...marshall(this.toJSON(), { removeUndefinedValues: true }),
      ...this.mainKeys(),
    };
  }

  toReversedItem(): Record<string, AttributeValue> {
    const item = this.toJSON();

    const reversedMutual: Record<string, unknown> = {
      ...item,
      byEntityType: item.entityType,
      byEntityId: item.entityId,
      entityType: item.byEntityType,
      entityId: item.byEntityId,
      data: this.byData,
    };

    return {
      ...marshall(reversedMutual, { removeUndefinedValues: true }),
      ...this.mainKeys(),
    };
  }

  toJSON(): Record<string, unknown> {
    return {
      byEntityType: this.byEntityType,
      byEntityId: this.byEntityId,
      entityType: this.entityType,
      entityId: this.entityId,
      mutualId: this.mutualId,
      data: this.data,
      mutualData: this.mutualData,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      mutualUpdatedAt: this.mutualUpdatedAt,
      expiresAt: this.expiresAt,
    };
  }
}

export class MutualRepository extends Repository {
  constructor(
    private readonly TABLE_NAME: string,
    private readonly dynamodbClient: DynamoDB,
    private readonly ddbUtils: DbUtils,
  ) {
    super();
  }

  async listEntitiesByEntity<
    B extends Entity,
    T extends Entity,
    M extends Record<string, unknown>,
  >(
    byEntityType: B,
    byEntityId: string,
    entityType: T,
    opts: {
      lastKey?: string;
      ProjectionExpression?: ProjectionExpressionValues | (string & {});
      limit?: number; // if this is not set, retrieve all items
    } = {},
  ): Promise<{
    items: Mutual<B, T, M>[];
    lastKey?: string;
  }> {
    const mutual = new Mutual(
      byEntityType,
      byEntityId,
      {},
      entityType,
      'list_by_only',
      {},
      {},
    );

    const listAssociationsQuery: QueryCommandInput = {
      TableName: this.TABLE_NAME,
      KeyConditionExpression: '#PK = :PK and begins_with(#SK, :SK)',
      FilterExpression:
        'attribute_not_exists(#expiresAt) or attribute_type(#expiresAt, :nullType)',
      ExpressionAttributeNames: {
        '#PK': 'PK',
        '#SK': 'SK',
        '#expiresAt': 'expiresAt',
      },
      ExpressionAttributeValues: {
        ':PK': {
          S: mutual.byFullEntityId,
        },
        ':SK': {
          S: `${mutual.listEntitySK}#`,
        },
        ':nullType': { S: 'NULL' },
      },
      ProjectionExpression: opts.ProjectionExpression,
      ScanIndexForward: false,
    };
    let lastKey = opts.lastKey;
    let items: Mutual<B, T, M>[] = [];
    let remainingCount = opts.limit ?? 0;
    do {
      const resp = await this.dynamodbClient.query({
        ...listAssociationsQuery,
        ...(remainingCount && { Limit: remainingCount }),
        ...(lastKey && {
          ExclusiveStartKey: fromLastKeyQuery(lastKey),
        }),
      });

      items = items.concat(
        resp.Items?.map((item) => Mutual.fromItem(item)) || [],
      );

      lastKey = toLastKeyResponse(resp.LastEvaluatedKey);
      if (opts.limit) {
        remainingCount = remainingCount - (resp.Items?.length ?? 0);
      }
    } while (
      // limit is given, haven't reach limit, and there are still items to retrieve
      (opts.limit && remainingCount && lastKey) ||
      // no limit is given and there are still items to retrieve
      (!opts.limit && lastKey)
    );

    return {
      items,
      lastKey,
    };
  }

  async getMutual<
    B extends Entity,
    T extends Entity,
    M extends Record<string, unknown>,
  >(
    byEntityType: B,
    byEntityId: string,
    entityType: T,
    entityId: string,
    opts?: {
      // isFromMetadata to prevent race condition by querying #METADATA#
      isFromMetadata?: boolean;
      ProjectionExpression?: string;
    },
  ): Promise<Mutual<B, T, M>> {
    const mutual = new Mutual(
      byEntityType,
      byEntityId,
      {},
      entityType,
      entityId,
      {},
      {},
    );

    const resp = await this.dynamodbClient.query({
      TableName: this.TABLE_NAME,
      KeyConditionExpression: '#PK = :PK and begins_with(#SK, :SK)',
      FilterExpression:
        'attribute_not_exists(#expiresAt) or attribute_type(#expiresAt, :nullType)',
      ExpressionAttributeNames: {
        '#PK': 'PK',
        '#SK': 'SK',
        '#expiresAt': 'expiresAt',
      },
      ExpressionAttributeValues: {
        ':PK': { S: mutual.byFullEntityId },
        ':SK': { S: mutual.fullEntityId },
        ':nullType': { S: 'NULL' },
      },
      Limit: 1,
    });

    let mutualMetadata: Mutual<B, T, M> | null = null;
    if (opts?.isFromMetadata) {
      const tempMutual = Mutual.fromItem<B, T, M>(resp.Items?.[0]);
      const respMetadataMutual = await this.dynamodbClient.getItem({
        TableName: this.TABLE_NAME,
        Key: tempMutual.mainKeys(),
        ProjectionExpression: opts?.ProjectionExpression,
      });

      mutualMetadata = Mutual.fromItem(respMetadataMutual.Item);
    }

    return mutualMetadata || Mutual.fromItem<B, T, M>(resp.Items?.[0]);
  }

  async checkMutualExist<B extends Entity, T extends Entity>(
    byEntityType: B,
    byEntityId: string,
    entityType: T,
    entityId: string,
  ): Promise<void> {
    const mutual = new Mutual(
      byEntityType,
      byEntityId,
      {},
      entityType,
      entityId,
      {},
      {},
    );
    const resp = await this.dynamodbClient.getItem({
      TableName: this.TABLE_NAME,
      Key: mutual.subKeys(),
      ProjectionExpression: 'PK, SK, expiresAt',
    });

    if (resp.Item && !resp.Item?.expiresAt) {
      throw new StandardError(
        StandardErrorCode.MUTUAL_EXISTS,
        'Entities are already linked',
      );
    }

    return;
  }

  createMutualTransactItems<
    B extends Entity,
    T extends Entity,
    M extends Record<string, unknown>,
  >(
    mutual: Mutual<B, T, M>,
    opts?: {
      ConditionExpression?: string;
      ExpressionAttributeNames?: Record<string, string>;
      ExpressionAttributeValues?: Record<string, AttributeValue>;
    },
  ): TransactWriteItem[] {
    const TransactItems: TransactWriteItem[] = [
      {
        Put: {
          TableName: this.TABLE_NAME,
          ConditionExpression:
            opts?.ConditionExpression ||
            'attribute_not_exists(PK) OR attribute_exists(expiresAt)',
          ExpressionAttributeNames: opts?.ExpressionAttributeNames,
          ExpressionAttributeValues: opts?.ExpressionAttributeValues,
          Item: mutual.toItem(),
        },
      },
      {
        Put: {
          TableName: this.TABLE_NAME,
          ConditionExpression:
            opts?.ConditionExpression ||
            'attribute_not_exists(PK) OR attribute_exists(expiresAt)',
          ExpressionAttributeNames: opts?.ExpressionAttributeNames,
          ExpressionAttributeValues: opts?.ExpressionAttributeValues,
          Item: {
            ...mutual.toItem(),
            PK: { S: mutual.byFullEntityId },
            SK: { S: mutual.fullEntityId },
            R1PK: { S: mutual.fullEntityId },
            R1SK: { S: mutual.byFullEntityId },
            R2PK: { S: mutual.mainPk },
            R2SK: { S: mutual.byFullEntityId },
          },
        },
      },
      {
        Put: {
          TableName: this.TABLE_NAME,
          ConditionExpression:
            opts?.ConditionExpression ||
            'attribute_not_exists(PK) OR attribute_exists(expiresAt)',
          ExpressionAttributeNames: opts?.ExpressionAttributeNames,
          ExpressionAttributeValues: opts?.ExpressionAttributeValues,
          Item: {
            ...mutual.toReversedItem(),
            PK: { S: mutual.fullEntityId },
            SK: { S: mutual.byFullEntityId },
            R1PK: { S: mutual.byFullEntityId },
            R1SK: { S: mutual.fullEntityId },
            R2PK: { S: mutual.mainPk },
            R2SK: { S: mutual.fullEntityId },
          },
        },
      },
    ];

    return TransactItems;
  }

  async createMutual<
    B extends Entity,
    T extends Entity,
    M extends Record<string, unknown>,
  >(
    byEntityType: B,
    byEntityId: string,
    byData: EntitySchemaMap[B] | Record<string, any>,
    entityType: T,
    entityId: string,
    data: EntitySchemaMap[T] | Record<string, any>,
    mutualData: M = {} as M,
    opts?: {
      ConditionExpression?: string;
      ExpressionAttributeNames?: Record<string, string>;
      ExpressionAttributeValues?: Record<string, AttributeValue>;
      createAndUpdateDatetime?: Date;
    },
  ): Promise<Mutual<B, T, M>> {
    const errorContext: Record<string, unknown> = {};
    const currentDatetime = opts?.createAndUpdateDatetime || new Date();
    const mutual = new Mutual<B, T, M>(
      byEntityType,
      byEntityId,
      byData,
      entityType,
      entityId,
      data,
      mutualData,
      ulid(),
      currentDatetime,
      currentDatetime,
      currentDatetime,
    );
    const TransactItems = this.createMutualTransactItems(mutual, {
      ConditionExpression: opts?.ConditionExpression,
      ExpressionAttributeNames: opts?.ExpressionAttributeNames,
      ExpressionAttributeValues: opts?.ExpressionAttributeValues,
    });
    errorContext.TransactItems = TransactItems;

    await this.dynamodbClient.transactWriteItems({ TransactItems });

    return mutual;
  }

  async updateMutual<
    B extends Entity,
    T extends Entity,
    M extends Record<string, unknown>,
  >(
    byEntityType: B,
    byEntityId: string,
    entityType: T,
    entityId: string,
    toUpdate: {
      mutualData: Record<string, unknown>;
      mutualUpdatedAt?: string;
      updatedAt?: string;
    },
    opts?: {
      ConditionExpression?: string;
      ExpressionAttributeNames?: Record<string, string>;
      ExpressionAttributeValues?: Record<string, AttributeValue>;
      returnUpdatedValue?: boolean;
      maxObjectUpdateLevel?: number;
    },
  ): Promise<Mutual<B, T, M> | undefined> {
    const returnUpdatedValue = opts?.returnUpdatedValue ?? false;
    const errorContext: Record<string, unknown> = {};

    try {
      const mutual = await this.getMutual<B, T, M>(
        byEntityType,
        byEntityId,
        entityType,
        entityId,
        { ProjectionExpression: PROJECTION_EXPRESSION.NO_DATA },
      );

      const currentDatetime = new Date().toISOString();
      const toUpdateExpressions = this.toUpdate(
        {
          mutualUpdatedAt: currentDatetime,
          ...toUpdate,
        },
        { maxLevel: opts?.maxObjectUpdateLevel },
      );
      const updateExpression = {
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

      const TransactItems: TransactWriteItem[] = [
        {
          Update: {
            TableName: this.TABLE_NAME,
            Key: mutual.mainKeys(),
            ...updateExpression,
          },
        },
        {
          Update: {
            TableName: this.TABLE_NAME,
            Key: {
              PK: { S: mutual.byFullEntityId },
              SK: { S: mutual.fullEntityId },
            },
            ...updateExpression,
          },
        },
        {
          Update: {
            TableName: this.TABLE_NAME,
            Key: {
              PK: { S: mutual.fullEntityId },
              SK: { S: mutual.byFullEntityId },
            },
            ...updateExpression,
          },
        },
      ];
      errorContext.TransactItems = TransactItems;

      await this.ddbUtils.executeTransactWrite({ TransactItems });

      if (!returnUpdatedValue) {
        return;
      }

      const updatedMutual = await this.getMutual<B, T, M>(
        byEntityType,
        byEntityId,
        entityType,
        entityId,
      );

      return updatedMutual;
    } catch (err) {
      if (
        err instanceof StandardError &&
        err.code === StandardErrorCode.CONDITIONAL_CHECK_FAILED
      ) {
        throw new StandardError(
          StandardErrorCode.MUTUAL_NOT_FOUND,
          'Mutual not found',
          err,
          {
            errorContext,
          },
        );
      }

      throw err;
    }
  }

  async deleteMutual<
    B extends Entity,
    T extends Entity,
    M extends Record<string, unknown>,
  >(
    byEntityType: B,
    byEntityId: string,
    entityType: T,
    entityId: string,
    opts?: {
      ConditionExpression?: string;
      ExpressionAttributeNames?: Record<string, string>;
      ExpressionAttributeValues?: Record<string, AttributeValue>;
    },
  ): Promise<Mutual<B, T, M>> {
    const errorContext: Record<string, unknown> = {
      byEntityType,
      byEntityId,
      entityType,
      entityId,
    };

    try {
      const mutual = await this.getMutual<B, T, M>(
        byEntityType,
        byEntityId,
        entityType,
        entityId,
        { ProjectionExpression: PROJECTION_EXPRESSION.NO_DATA },
      );

      const tenMinsLater = Math.floor(new Date().getTime() / 1000 + 10 * 60);
      const expressions = {
        UpdateExpression:
          'SET #expiresAt = :expiresAt, #mutualUpdatedAt = :mutualUpdatedAt, #updatedAt = :mutualUpdatedAt',
        ConditionExpression:
          opts?.ConditionExpression ||
          'attribute_exists(PK) AND attribute_not_exists(#expiresAt)',
        ExpressionAttributeNames: {
          '#expiresAt': 'expiresAt',
          '#mutualUpdatedAt': 'mutualUpdatedAt',
          '#updatedAt': 'updatedAt',
          ...opts?.ExpressionAttributeNames,
        },
        ExpressionAttributeValues: {
          ':expiresAt': { N: String(tenMinsLater) },
          ':mutualUpdatedAt': { S: new Date().toISOString() },
          ...opts?.ExpressionAttributeValues,
        },
      };

      const TransactItems: TransactWriteItem[] = [
        {
          Update: {
            TableName: this.TABLE_NAME,
            Key: mutual.mainKeys(),
            ...expressions,
          },
        },
        {
          Update: {
            TableName: this.TABLE_NAME,
            Key: {
              PK: { S: mutual.byFullEntityId },
              SK: { S: mutual.fullEntityId },
            },
            ...expressions,
          },
        },
        {
          Update: {
            TableName: this.TABLE_NAME,
            Key: {
              PK: { S: mutual.fullEntityId },
              SK: { S: mutual.byFullEntityId },
            },
            ...expressions,
          },
        },
      ];
      errorContext.TransactItems = TransactItems;

      await this.dynamodbClient.transactWriteItems({ TransactItems });

      return mutual;
    } catch (err) {
      const isConditionalCheckFailed =
        err instanceof TransactionCanceledException &&
        err.CancellationReasons?.some(
          (reason) =>
            reason.Code === BatchStatementErrorCodeEnum.ConditionalCheckFailed,
        );

      const isMutualIsUndefined =
        err instanceof StandardError &&
        err.code === StandardErrorCode.MUTUAL_IS_UNDEFINED;

      if (isConditionalCheckFailed || isMutualIsUndefined) {
        throw new StandardError(
          StandardErrorCode.MUTUAL_NOT_FOUND,
          'Mutual not found',
          err,
          {
            errorContext,
          },
        );
      }

      throw err;
    }
  }

  async createMutualLock<B extends Entity, T extends Entity>({
    byEntityType,
    byEntityId,
    entityType,
    version,
  }: {
    byEntityType: B;
    byEntityId: string;
    entityType: T;
    version: string;
  }): Promise<void> {
    let retryCount = 2;

    const itemKey = {
      PK: {
        S: `MUTUAL#${byEntityType}#${byEntityId}#${entityType}`,
      },
      SK: { S: '#LOCK#' },
    };

    do {
      try {
        const fiveMinsLater = Math.floor(new Date().getTime() / 1000 + 5 * 60);

        await this.dynamodbClient.putItem({
          TableName: this.TABLE_NAME,
          Item: {
            ...itemKey,
            version: { S: version },
            status: { S: 'LOCK' },
            expiresAt: {
              // auto release lock in case the mutual logic gone wrong to prevent dead lock
              N: `${fiveMinsLater}`,
            },
          },
          ConditionExpression:
            'attribute_not_exists(PK) OR version < :version AND #status <> :status',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':version': { S: version },
            ':status': { S: 'LOCK' },
          },
        });

        return;
      } catch (err) {
        console.log('=====CATCHED_MUTUAL_LOCK_CONFLICT=====');

        const lock = await this.dynamodbClient.getItem({
          TableName: this.TABLE_NAME,
          Key: itemKey,
        });

        // if version is lower, throw not retryable error to skip
        const existingVersion = lock.Item?.version?.S ?? '';
        const isExistingVersionGreaterThanNewVersion =
          existingVersion >= version;
        if (isExistingVersionGreaterThanNewVersion) {
          throw new StandardError(
            StandardErrorCode.MUTUAL_LOCK_CONFLICT,
            'Lock conflict',
            err,
            { lock: lock.Item },
          );
        }

        // default behaviour
        // if version is higher, retry
        // if lock not found, retry

        await sleep(2000);
        console.log('=====RETRY_MUTUAL_LOCK=====');
      }
    } while (retryCount-- > 0);

    // catch real unhandled error, so it can reach DLQ for inspection
    throw new StandardError(
      StandardErrorCode.RETRYABLE_MUTUAL_LOCK_CONFLICT,
      'Retryable lock conflict',
    );
  }

  async deleteMutualLock<B extends Entity, T extends Entity>({
    byEntityType,
    byEntityId,
    entityType,
  }: {
    byEntityType: B;
    byEntityId: string;
    entityType: T;
  }): Promise<void> {
    try {
      await this.dynamodbClient.updateItem({
        TableName: this.TABLE_NAME,
        Key: {
          PK: {
            S: `MUTUAL#${byEntityType}#${byEntityId}#${entityType}`,
          },
          SK: { S: '#LOCK#' },
        },
        UpdateExpression: 'REMOVE #status',
        ExpressionAttributeNames: { '#status': 'status' },
      });

      return;
    } catch (error) {
      // if lock is not found, it's okay
    }
  }
}
