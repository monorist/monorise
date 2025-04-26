import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDB,
  waitUntilTableExists,
  waitUntilTableNotExists,
} from '@aws-sdk/client-dynamodb';
import {
  DescribeStreamCommand,
  DynamoDBStreamsClient,
  GetRecordsCommand,
  GetShardIteratorCommand,
} from '@aws-sdk/client-dynamodb-streams';
import { createEntityConfig } from '@monorise/base';
import { ulid } from 'ulid';
import { z } from 'zod';
import {
  ENTITY_REPLICATION_INDEX,
  MUTUAL_REPLICATION_INDEX,
} from '../../dist/constants/table';
import { handler as replicationHandlerFunction } from '../../processors/replication-processor';
import type { DependencyContainer } from '../../services/DependencyContainer';

// --- Common Enums and Types ---
export enum MockEntityType {
  USER = 'user',
  PRODUCT = 'product',
  ADMIN = 'admin',
  COURSE = 'course',
}

// --- Configuration ---
export const getTableName = () => `monorise-core-test-${ulid()}`; // Unique table name for test isolation
export const LOCALSTACK_ENDPOINT =
  process.env.LOCALSTACK_ENDPOINT || 'http://localhost:4566';

// --- DynamoDB Client Creation ---
export const createDynamoDbClient = () =>
  new DynamoDB({
    endpoint: LOCALSTACK_ENDPOINT,
    region: 'us-east-1', // LocalStack default region
    credentials: {
      accessKeyId: 'test', // LocalStack default credentials
      secretAccessKey: 'test',
    },
  });

export const createStreamClient = () =>
  new DynamoDBStreamsClient({
    endpoint: LOCALSTACK_ENDPOINT,
    region: 'us-east-1',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });

// --- Entity Config Factory ---
export const createMockEntityConfig = () => ({
  [MockEntityType.USER]: createEntityConfig({
    name: MockEntityType.USER,
    displayName: 'User',
    baseSchema: z
      .object({
        name: z.string(),
        email: z.string().email(),
        role: z.string(),
        username: z.string(),
        age: z.number(),
        newField: z.string(),
        city: z.string(),
      })
      .partial(),
    createSchema: z.object({
      name: z.string(),
      username: z.string(),
    }),
    uniqueFields: ['username'],
    searchableFields: ['name', 'email'],
    authMethod: { email: { tokenExpiresIn: 3600000 } },
  }),
  [MockEntityType.PRODUCT]: createEntityConfig({
    name: MockEntityType.PRODUCT,
    displayName: 'Product',
    baseSchema: z.object({
      name: z.string(),
      description: z.string(),
      price: z.number(),
    }),
    searchableFields: ['name', 'description'],
  }),
  [MockEntityType.ADMIN]: createEntityConfig({
    name: MockEntityType.ADMIN,
    displayName: 'Admin',
    baseSchema: z.object({}), // Empty schema for placeholder
  }),
  [MockEntityType.COURSE]: createEntityConfig({
    name: MockEntityType.COURSE,
    displayName: 'Course',
    baseSchema: z.object({}), // Empty schema for placeholder
  }),
});

// --- Table Creation and Deletion ---
export const createBasicTestTable = async (
  tableName: string,
  dynamodbClient: DynamoDB,
  opts: { enableStream?: boolean } = {},
) => {
  const command = new CreateTableCommand({
    TableName: tableName,
    KeySchema: [
      { AttributeName: 'PK', KeyType: 'HASH' },
      { AttributeName: 'SK', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: 'S' },
      { AttributeName: 'SK', AttributeType: 'S' },
      { AttributeName: 'R1PK', AttributeType: 'S' },
      { AttributeName: 'R1SK', AttributeType: 'S' },
      { AttributeName: 'R2PK', AttributeType: 'S' },
      { AttributeName: 'R2SK', AttributeType: 'S' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
    GlobalSecondaryIndexes: [
      {
        IndexName: ENTITY_REPLICATION_INDEX,
        KeySchema: [
          { AttributeName: 'R1PK', KeyType: 'HASH' },
          { AttributeName: 'R1SK', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
      {
        IndexName: MUTUAL_REPLICATION_INDEX,
        KeySchema: [
          { AttributeName: 'R2PK', KeyType: 'HASH' },
          { AttributeName: 'R2SK', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
    ...(opts.enableStream && {
      StreamSpecification: {
        StreamEnabled: true,
        StreamViewType: 'NEW_AND_OLD_IMAGES',
      },
    }),
  });

  await dynamodbClient.send(command);
  await waitUntilTableExists(
    { client: dynamodbClient, maxWaitTime: 30 },
    { TableName: tableName },
  );
};

export const createStreamEnabledTestTable = async (
  tableName: string,
  dynamodbClient: DynamoDB,
  indexNames = {
    entityReplication: 'GSI1',
    mutualReplication: 'GSI2',
  },
) => {
  const command = new CreateTableCommand({
    TableName: tableName,
    KeySchema: [
      { AttributeName: 'PK', KeyType: 'HASH' },
      { AttributeName: 'SK', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: 'S' },
      { AttributeName: 'SK', AttributeType: 'S' },
      { AttributeName: 'R1PK', AttributeType: 'S' },
      { AttributeName: 'R1SK', AttributeType: 'S' },
      { AttributeName: 'R2PK', AttributeType: 'S' },
      { AttributeName: 'R2SK', AttributeType: 'S' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
    GlobalSecondaryIndexes: [
      {
        IndexName: indexNames.entityReplication,
        KeySchema: [
          { AttributeName: 'R1PK', KeyType: 'HASH' },
          { AttributeName: 'R1SK', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
      {
        IndexName: indexNames.mutualReplication,
        KeySchema: [
          { AttributeName: 'R2PK', KeyType: 'HASH' },
          { AttributeName: 'R2SK', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
    StreamSpecification: {
      StreamEnabled: true,
      StreamViewType: 'NEW_AND_OLD_IMAGES',
    },
  });

  await dynamodbClient.send(command);
  await waitUntilTableExists(
    { client: dynamodbClient, maxWaitTime: 30 },
    { TableName: tableName },
  );
};

export const deleteTestTable = async (
  tableName: string,
  dynamodbClient: DynamoDB,
) => {
  const command = new DeleteTableCommand({ TableName: tableName });
  try {
    await dynamodbClient.send(command);
    await waitUntilTableNotExists(
      { client: dynamodbClient, maxWaitTime: 30 },
      { TableName: tableName },
    );
  } catch (error) {
    console.error(`Error deleting table ${tableName}:`, error);
    if ((error as Error).name !== 'ResourceNotFoundException') {
      throw error;
    }
  }
};

// --- Stream Handling ---
export const waitForStreamReady = async (
  tableName: string,
  dynamodbClient: DynamoDB,
  streamClient: DynamoDBStreamsClient,
  timeoutMs = 10000,
) => {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const { Table } = await dynamodbClient.describeTable({
      TableName: tableName,
    });

    if (!Table?.LatestStreamArn || !Table?.LatestStreamLabel) {
      continue;
    }

    const streamArn = Table.LatestStreamArn;

    const { StreamDescription } = await streamClient.send(
      new DescribeStreamCommand({ StreamArn: streamArn }),
    );

    if (StreamDescription?.StreamStatus === 'ENABLED') {
      return streamArn;
    }

    await new Promise((resolve) => setTimeout(resolve, 500)); // wait 0.5s before retry
  }

  throw new Error(
    `Stream for table ${tableName} did not become ready within ${timeoutMs}ms`,
  );
};

export class StreamHandler {
  private shardIterator?: string;
  private readonly streamClient: DynamoDBStreamsClient;
  private readonly dynamodbClient: DynamoDB;
  private streamArn?: string;
  private tableName: string;

  constructor(
    tableName: string,
    dynamodbClient: DynamoDB,
    streamClient: DynamoDBStreamsClient,
  ) {
    this.tableName = tableName;
    this.dynamodbClient = dynamodbClient;
    this.streamClient = streamClient;
  }

  async initialize() {
    const { Table } = await this.dynamodbClient.describeTable({
      TableName: this.tableName,
    });
    this.streamArn = Table?.LatestStreamArn;

    const { StreamDescription } = await this.streamClient.send(
      new DescribeStreamCommand({ StreamArn: this.streamArn }),
    );

    const shardId = StreamDescription?.Shards?.[0]?.ShardId;

    const { ShardIterator } = await this.streamClient.send(
      new GetShardIteratorCommand({
        StreamArn: this.streamArn,
        ShardId: shardId,
        ShardIteratorType: 'LATEST',
      }),
    );

    this.shardIterator = ShardIterator;
  }

  async getNextRecords() {
    if (!this.shardIterator) throw new Error('Stream not initialized yet.');

    const { Records, NextShardIterator } = await this.streamClient.send(
      new GetRecordsCommand({ ShardIterator: this.shardIterator }),
    );

    this.shardIterator = NextShardIterator; // 👉 move forward
    return Records;
  }
}

export const createReplicationHandler = (
  TABLE_NAME: string,
  dynamodbClient: DynamoDB,
) =>
  replicationHandlerFunction({
    dynamodbClient,
    coreTable: TABLE_NAME,
  } as unknown as DependencyContainer);

export const replicateData = async (
  streamHandler: StreamHandler,
  replicationHandler: ReturnType<typeof createReplicationHandler>,
) => {
  const records = await streamHandler.getNextRecords();
  await replicationHandler({ Records: records || [] });
};
