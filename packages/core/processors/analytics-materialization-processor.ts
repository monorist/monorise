import {
  AthenaClient,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  StartQueryExecutionCommand,
} from '@aws-sdk/client-athena';

type Column = {
  name: string;
  sourceName: string;
  type: 'boolean' | 'double' | 'string' | 'timestamp' | 'json';
};

type Dataset = {
  kind: 'entity' | 'mutual';
  name: string;
  currentTable: string;
  historyTable: string;
  rawTable?: string;
  columns: Column[];
};

type Manifest = { datasets: Dataset[] };

const athena = new AthenaClient();

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function manifest(): Manifest {
  return JSON.parse(required('ANALYTICS_MANIFEST')) as Manifest;
}

function valueExpression(column: Column, kind: Dataset['kind']): string {
  const payload = 'coalesce(after, before)';
  const path = `$.${kind === 'mutual' ? 'mutualData' : 'data'}.${column.sourceName.replaceAll('"', '\\"')}`;
  const scalar = `json_extract_scalar(payload, ${quoteLiteral(path)})`;
  switch (column.type) {
    case 'boolean':
      return `try_cast(${scalar} AS boolean)`;
    case 'double':
      return `try_cast(${scalar} AS double)`;
    case 'timestamp':
      return `try_cast(from_iso8601_timestamp(${scalar}) AS timestamp)`;
    case 'json':
      return `json_format(json_extract(payload, ${quoteLiteral(path)}))`;
    default:
      return scalar;
  }
}

function datasetSql(
  dataset: Dataset,
  database: string,
  bucket: string,
): string[] {
  const history = `${quoteIdentifier(database)}.${quoteIdentifier(dataset.historyTable)}`;
  const current = `${quoteIdentifier(database)}.${quoteIdentifier(dataset.currentTable)}`;
  const raw = `${quoteIdentifier(database)}.${quoteIdentifier(dataset.rawTable ?? `${dataset.historyTable}_raw`)}`;
  const typedColumns = dataset.columns.map(
    (column) =>
      `${quoteIdentifier(column.name)} ${column.type === 'json' ? 'varchar' : column.type}`,
  );
  const names = dataset.columns.map((column) => quoteIdentifier(column.name));
  const values = dataset.columns.map((column) =>
    valueExpression(column, dataset.kind),
  );
  const payload = 'coalesce(after, before)';
  const recordIdPath = dataset.kind === 'entity' ? '$.entityId' : '$.mutualId';
  const selected = [
    'event_id',
    'idempotency_key',
    'ordering_key',
    'sequence_number',
    'operation',
    'try_cast(from_iso8601_timestamp(occurred_at) AS timestamp) AS occurred_at',
    `json_extract_scalar(${payload}, ${quoteLiteral(recordIdPath)}) AS record_id`,
    'before AS before_json',
    'after AS after_json',
    ...values.map((value, index) => `${value} AS ${names[index]}`),
  ];
  const allColumns = [
    'event_id varchar',
    'idempotency_key varchar',
    'ordering_key varchar',
    'sequence_number varchar',
    'operation varchar',
    'occurred_at timestamp',
    'record_id varchar',
    'before_json varchar',
    'after_json varchar',
    ...typedColumns,
  ];
  const historyNames = [
    'event_id',
    'idempotency_key',
    'ordering_key',
    'sequence_number',
    'operation',
    'occurred_at',
    'record_id',
    'before_json',
    'after_json',
    ...names,
  ]
    .map(quoteIdentifier)
    .join(', ');
  const insertValues = [
    's.event_id',
    's.idempotency_key',
    's.ordering_key',
    's.sequence_number',
    's.operation',
    's.occurred_at',
    's.record_id',
    's.before_json',
    's.after_json',
    ...names.map((name) => `s.${name}`),
  ].join(', ');

  return [
    `CREATE TABLE IF NOT EXISTS ${history} (${allColumns.join(', ')}) LOCATION ${quoteLiteral(`s3://${bucket}/curated/history/${dataset.kind === 'entity' ? 'entities' : 'mutuals'}/${dataset.name}/`)} TBLPROPERTIES ('table_type'='ICEBERG')`,
    `MERGE INTO ${history} h USING (SELECT * FROM (SELECT ${selected.join(', ')}, row_number() OVER (PARTITION BY event_id ORDER BY ordering_key DESC) AS row_number FROM ${raw}) WHERE row_number = 1) s ON h.event_id = s.event_id WHEN NOT MATCHED THEN INSERT (${historyNames}) VALUES (${insertValues})`,
    `CREATE TABLE IF NOT EXISTS ${current} (${allColumns.filter((column) => !column.startsWith('event_id ') && !column.startsWith('idempotency_key ') && !column.startsWith('sequence_number ') && !column.startsWith('before_json ') && !column.startsWith('after_json ')).join(', ')}) LOCATION ${quoteLiteral(`s3://${bucket}/current/${dataset.name}/`)} TBLPROPERTIES ('table_type'='ICEBERG')`,
    `MERGE INTO ${current} c USING (SELECT * FROM (SELECT h.*, row_number() OVER (PARTITION BY record_id ORDER BY occurred_at DESC, ordering_key DESC) AS row_number FROM ${history} h) WHERE row_number = 1) s ON c.record_id = s.record_id WHEN MATCHED AND s.operation = 'REMOVE' THEN DELETE WHEN MATCHED THEN UPDATE SET operation = s.operation, occurred_at = s.occurred_at, ordering_key = s.ordering_key${names.map((name) => `, ${name} = s.${name}`).join('')} WHEN NOT MATCHED AND s.operation <> 'REMOVE' THEN INSERT (operation, occurred_at, ordering_key, record_id${names.length ? `, ${names.join(', ')}` : ''}) VALUES (s.operation, s.occurred_at, s.ordering_key, s.record_id${names.length ? `, ${names.map((name) => `s.${name}`).join(', ')}` : ''})`,
  ];
}

async function execute(statement: string): Promise<string> {
  const started = await athena.send(
    new StartQueryExecutionCommand({
      QueryString: statement,
      WorkGroup: required('ANALYTICS_WORKGROUP'),
      QueryExecutionContext: { Database: required('ANALYTICS_DATABASE') },
      ResultConfiguration: {
        OutputLocation: required('ANALYTICS_ATHENA_OUTPUT'),
      },
    }),
  );
  if (!started.QueryExecutionId)
    throw new Error('Athena did not return a query execution id.');
  for (;;) {
    const status = (
      await athena.send(
        new GetQueryExecutionCommand({
          QueryExecutionId: started.QueryExecutionId,
        }),
      )
    ).QueryExecution?.Status;
    if (status?.State === 'SUCCEEDED') return started.QueryExecutionId;
    if (status?.State === 'FAILED' || status?.State === 'CANCELLED') {
      throw new Error(
        `Athena materialization query ${started.QueryExecutionId} ${status.State}: ${status.StateChangeReason ?? 'no reason provided'}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function tableColumns(
  database: string,
  table: string,
): Promise<Set<string>> {
  const queryExecutionId = await execute(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = ${quoteLiteral(database)} AND table_name = ${quoteLiteral(table)}`,
  );
  const result = await athena.send(
    new GetQueryResultsCommand({ QueryExecutionId: queryExecutionId }),
  );
  return new Set(
    (result.ResultSet?.Rows ?? [])
      .slice(1)
      .map((row) => row.Data?.[0]?.VarCharValue)
      .filter((name): name is string => Boolean(name)),
  );
}

async function addMissingColumns(
  database: string,
  table: string,
  columns: string[],
) {
  const existing = await tableColumns(database, table);
  const missing = columns.filter(
    (column) =>
      !existing.has(
        column.match(/^"((?:[^"]|"")+)"/)?.[1].replaceAll('""', '"') ?? '',
      ),
  );
  if (missing.length)
    await execute(
      `ALTER TABLE ${quoteIdentifier(database)}.${quoteIdentifier(table)} ADD COLUMNS (${missing.join(', ')})`,
    );
}

export const handler = async () => {
  const database = required('ANALYTICS_DATABASE');
  const bucket = required('ANALYTICS_BUCKET');
  for (const dataset of manifest().datasets) {
    const statements = datasetSql(dataset, database, bucket);
    await execute(statements[0]);
    await addMissingColumns(
      database,
      dataset.historyTable,
      dataset.columns.map(
        (column) =>
          `${quoteIdentifier(column.name)} ${column.type === 'json' ? 'varchar' : column.type}`,
      ),
    );
    await execute(statements[2]);
    await addMissingColumns(
      database,
      dataset.currentTable,
      dataset.columns.map(
        (column) =>
          `${quoteIdentifier(column.name)} ${column.type === 'json' ? 'varchar' : column.type}`,
      ),
    );
    for (const statement of [statements[1], statements[3]]) {
      await execute(statement);
    }
  }
};

export { datasetSql };
