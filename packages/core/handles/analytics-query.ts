import {
  AthenaClient,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  StartQueryExecutionCommand,
  StopQueryExecutionCommand,
} from '@aws-sdk/client-athena';
import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { handle } from 'hono/aws-lambda';
import { Hono } from 'hono';
import httpStatus from 'http-status';

type Query = {
  sql: string;
  parameters?: Record<string, { type: 'string' | 'number' | 'boolean' | 'date' | 'timestamp' }>;
  resultReuse?: { maxAgeMinutes: number };
};

const athena = new AthenaClient();
const dynamo = new DynamoDBClient();

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function queries(): Record<string, Query> {
  return JSON.parse(required('ANALYTICS_QUERIES')) as Record<string, Query>;
}

function validParameter(value: unknown, type: NonNullable<Query['parameters']>[string]['type']): string | undefined {
  if (type === 'string' && typeof value === 'string') return value;
  if (type === 'number' && typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (type === 'boolean' && typeof value === 'boolean') return String(value);
  if (type === 'date' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (type === 'timestamp' && typeof value === 'string' && !Number.isNaN(Date.parse(value))) return value;
  return undefined;
}

export function executionParameter(value: string, type: NonNullable<Query['parameters']>[string]['type']): string {
  if (type === 'string') return `'${value.replaceAll("'", "''")}'`;
  if (type === 'date') return `DATE '${value}'`;
  if (type === 'timestamp') return `TIMESTAMP '${value.replaceAll("'", "''")}'`;
  return value;
}

function apiKeys(): string[] {
  return process.env.ANALYTICS_API_KEYS
    ? JSON.parse(process.env.ANALYTICS_API_KEYS) as string[]
    : [];
}

async function ownedExecution(id: string): Promise<boolean> {
  const item = await dynamo.send(new GetItemCommand({
    TableName: required('ANALYTICS_EXECUTIONS_TABLE'),
    Key: { id: { S: id } },
    ConsistentRead: true,
  }));
  return Boolean(item.Item);
}

export const analyticsQueryHandler = () => {
  const app = new Hono().basePath('/analytics');
  app.use('*', async (c, next) => {
    const key = c.req.header('x-api-key');
    if (!key || !apiKeys().includes(key)) {
      return c.json({ status: httpStatus.UNAUTHORIZED, message: httpStatus['401_MESSAGE'] }, httpStatus.UNAUTHORIZED);
    }
    return next();
  });

  app.get('/queries', (c) => c.json({
    queries: Object.entries(queries()).map(([name, query]) => ({ name, parameters: query.parameters ?? {} })),
  }));

  app.post('/queries/:name/executions', async (c) => {
    const query = queries()[c.req.param('name')];
    if (!query) return c.json({ message: 'Unknown analytics query.' }, httpStatus.NOT_FOUND);
    const body: Record<string, unknown> = await c.req
      .json<Record<string, unknown>>()
      .catch(() => ({} as Record<string, unknown>));
    const declared = query.parameters ?? {};
    if (Object.keys(body).some((name) => !(name in declared))) {
      return c.json({ message: 'Unexpected query parameter.' }, httpStatus.BAD_REQUEST);
    }
    const parameters = Object.entries(declared).map(([name, definition]) => {
      const value = validParameter(body[name], definition.type);
      if (value === undefined) throw new Error(`Invalid or missing parameter: ${name}.`);
      return executionParameter(value, definition.type);
    });
    try {
      const started = await athena.send(new StartQueryExecutionCommand({
        QueryString: query.sql,
        ExecutionParameters: parameters,
        WorkGroup: required('ANALYTICS_WORKGROUP'),
        QueryExecutionContext: { Database: required('ANALYTICS_DATABASE') },
        ResultConfiguration: { OutputLocation: required('ANALYTICS_ATHENA_OUTPUT') },
        ResultReuseConfiguration: query.resultReuse
          ? { ResultReuseByAgeConfiguration: { Enabled: true, MaxAgeInMinutes: query.resultReuse.maxAgeMinutes } }
          : undefined,
      }));
      if (!started.QueryExecutionId) throw new Error('Athena did not return a query execution id.');
      await dynamo.send(new PutItemCommand({
        TableName: required('ANALYTICS_EXECUTIONS_TABLE'),
        Item: {
          id: { S: started.QueryExecutionId },
          queryName: { S: c.req.param('name') },
          expiresAt: { N: String(Math.floor(Date.now() / 1000) + 86_400) },
        },
      }));
      return c.json({ queryExecutionId: started.QueryExecutionId, state: 'QUEUED' }, httpStatus.ACCEPTED);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Invalid or missing parameter:')) {
        return c.json({ message: error.message }, httpStatus.BAD_REQUEST);
      }
      throw error;
    }
  });

  app.get('/executions/:id', async (c) => {
    const id = c.req.param('id');
    if (!await ownedExecution(id)) return c.json({ message: 'Unknown analytics execution.' }, httpStatus.NOT_FOUND);
    const execution = await athena.send(new GetQueryExecutionCommand({ QueryExecutionId: id }));
    const status = execution.QueryExecution?.Status;
    return c.json({
      queryExecutionId: id,
      state: status?.State,
      reason: status?.StateChangeReason,
      statistics: execution.QueryExecution?.Statistics,
      reusedPreviousResult: execution.QueryExecution?.Statistics?.ResultReuseInformation?.ReusedPreviousResult,
    });
  });

  app.get('/executions/:id/results', async (c) => {
    const id = c.req.param('id');
    if (!await ownedExecution(id)) return c.json({ message: 'Unknown analytics execution.' }, httpStatus.NOT_FOUND);
    const requested = Number(c.req.query('maxResults') ?? 100);
    const maxResults = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 1_000) : 100;
    const nextToken = c.req.query('nextToken');
    const results = await athena.send(new GetQueryResultsCommand({
      QueryExecutionId: id,
      NextToken: nextToken,
      MaxResults: maxResults,
    }));
    const rows = results.ResultSet?.Rows ?? [];
    const columns = (results.ResultSet?.ResultSetMetadata?.ColumnInfo ?? []).map((column) => column.Name);
    return c.json({
      columns,
      rows: rows.slice(nextToken ? 0 : 1).map((row) => (row.Data ?? []).map((value) => value.VarCharValue ?? null)),
      nextToken: results.NextToken,
    });
  });

  app.post('/executions/:id/cancel', async (c) => {
    const id = c.req.param('id');
    if (!await ownedExecution(id)) return c.json({ message: 'Unknown analytics execution.' }, httpStatus.NOT_FOUND);
    await athena.send(new StopQueryExecutionCommand({ QueryExecutionId: id }));
    return c.body(null, httpStatus.NO_CONTENT);
  });

  return handle(app);
};
