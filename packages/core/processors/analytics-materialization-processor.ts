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
  idColumn: string;
  endpoints: {
    entityName: string;
    column: string;
    role?: 'source' | 'target';
  }[];
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

function quoteDdlIdentifier(identifier: string): string {
  return `\`${identifier.replaceAll('`', '``')}\``;
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

function endpointExpression(
  endpoint: Dataset['endpoints'][number],
): string {
  const payload = 'coalesce(after, before)';
  if (endpoint.role === 'source') {
    return `json_extract_scalar(${payload}, '$.byEntityId')`;
  }
  if (endpoint.role === 'target') {
    return `json_extract_scalar(${payload}, '$.entityId')`;
  }
  const entityName = quoteLiteral(endpoint.entityName);
  return `CASE WHEN json_extract_scalar(${payload}, '$.byEntityType') = ${entityName} THEN json_extract_scalar(${payload}, '$.byEntityId') WHEN json_extract_scalar(${payload}, '$.entityType') = ${entityName} THEN json_extract_scalar(${payload}, '$.entityId') END`;
}

function datasetSql(
  dataset: Dataset,
  database: string,
  bucket: string,
): string[] {
  const history = `${quoteIdentifier(database)}.${quoteIdentifier(dataset.historyTable)}`;
  const current = `${quoteIdentifier(database)}.${quoteIdentifier(dataset.currentTable)}`;
  const historyDdl = `${quoteDdlIdentifier(database)}.${quoteDdlIdentifier(dataset.historyTable)}`;
  const currentDdl = `${quoteDdlIdentifier(database)}.${quoteDdlIdentifier(dataset.currentTable)}`;
  const raw = `${quoteIdentifier(database)}.${quoteIdentifier(dataset.rawTable ?? `${dataset.historyTable}_raw`)}`;
  const typedColumns = dataset.columns.map(
    (column) =>
      `${quoteIdentifier(column.name)} ${column.type === 'json' ? 'varchar' : column.type}`,
  );
  const names = dataset.columns.map((column) => quoteIdentifier(column.name));
  const endpointNames = dataset.endpoints.map((endpoint) =>
    quoteIdentifier(endpoint.column),
  );
  const values = dataset.columns.map((column) =>
    valueExpression(column, dataset.kind),
  );
  const payload = 'coalesce(after, before)';
  const idPath = dataset.kind === 'entity' ? '$.entityId' : '$.mutualId';
  const selected = [
    'event_id',
    'idempotency_key',
    'ordering_key',
    'sequence_number',
    'operation',
    'try_cast(from_iso8601_timestamp(occurred_at) AS timestamp) AS occurred_at',
    `json_extract_scalar(${payload}, ${quoteLiteral(idPath)}) AS ${quoteIdentifier(dataset.idColumn)}`,
    'before AS before_json',
    'after AS after_json',
    ...dataset.endpoints.map(
      (endpoint) => `${endpointExpression(endpoint)} AS ${quoteIdentifier(endpoint.column)}`,
    ),
    ...values.map((value, index) => `${value} AS ${names[index]}`),
  ];
  const allColumns = [
    'event_id varchar',
    'idempotency_key varchar',
    'ordering_key varchar',
    'sequence_number varchar',
    'operation varchar',
    'occurred_at timestamp',
    `${quoteIdentifier(dataset.idColumn)} varchar`,
    'before_json varchar',
    'after_json varchar',
    ...endpointNames.map((name) => `${name} varchar`),
    ...typedColumns,
  ];
  const historyNames = [
    'event_id',
    'idempotency_key',
    'ordering_key',
    'sequence_number',
    'operation',
    'occurred_at',
    dataset.idColumn,
    'before_json',
    'after_json',
    ...dataset.endpoints.map((endpoint) => endpoint.column),
    ...dataset.columns.map((column) => column.name),
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
    `s.${quoteIdentifier(dataset.idColumn)}`,
    's.before_json',
    's.after_json',
    ...endpointNames.map((name) => `s.${name}`),
    ...names.map((name) => `s.${name}`),
  ].join(', ');

  return [
    `CREATE TABLE ${historyDdl} (${allColumns.join(', ')}) WITH (table_type = 'ICEBERG', location = ${quoteLiteral(`s3://${bucket}/curated/history/${dataset.kind === 'entity' ? 'entities' : 'mutuals'}/${dataset.name}/`)})`,
    `MERGE INTO ${history} h USING (SELECT * FROM (SELECT ${selected.join(', ')}, row_number() OVER (PARTITION BY event_id ORDER BY ordering_key DESC) AS row_number FROM ${raw}) WHERE row_number = 1) s ON h.event_id = s.event_id WHEN NOT MATCHED THEN INSERT (${historyNames}) VALUES (${insertValues})`,
    `CREATE TABLE ${currentDdl} (${allColumns.filter((column) => !column.startsWith('event_id ') && !column.startsWith('idempotency_key ') && !column.startsWith('sequence_number ') && !column.startsWith('before_json ') && !column.startsWith('after_json ')).join(', ')}) WITH (table_type = 'ICEBERG', location = ${quoteLiteral(`s3://${bucket}/current/${dataset.name}/`)})`,
    `MERGE INTO ${current} c USING (SELECT * FROM (SELECT h.*, row_number() OVER (PARTITION BY ${quoteIdentifier(dataset.idColumn)} ORDER BY occurred_at DESC, ordering_key DESC) AS row_number FROM ${history} h) WHERE row_number = 1) s ON c.${quoteIdentifier(dataset.idColumn)} = s.${quoteIdentifier(dataset.idColumn)} WHEN MATCHED AND s.operation = 'REMOVE' THEN DELETE WHEN MATCHED THEN UPDATE SET operation = s.operation, occurred_at = s.occurred_at, ordering_key = s.ordering_key${endpointNames.map((name) => `, ${name} = s.${name}`).join('')}${names.map((name) => `, ${name} = s.${name}`).join('')} WHEN NOT MATCHED AND s.operation <> 'REMOVE' THEN INSERT (operation, occurred_at, ordering_key, ${quoteIdentifier(dataset.idColumn)}${endpointNames.length ? `, ${endpointNames.join(', ')}` : ''}${names.length ? `, ${names.join(', ')}` : ''}) VALUES (s.operation, s.occurred_at, s.ordering_key, s.${quoteIdentifier(dataset.idColumn)}${endpointNames.length ? `, ${endpointNames.map((name) => `s.${name}`).join(', ')}` : ''}${names.length ? `, ${names.map((name) => `s.${name}`).join(', ')}` : ''})`,
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

async function createTable(statement: string) {
  try {
    await execute(statement);
  } catch (error) {
    if (/already exists/i.test(error instanceof Error ? error.message : String(error))) return;
    throw error;
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

function generatedColumns(dataset: Dataset): string[] {
  return [
    `${quoteIdentifier(dataset.idColumn)} varchar`,
    ...dataset.endpoints.map(
      (endpoint) => `${quoteIdentifier(endpoint.column)} varchar`,
    ),
  ];
}

export const handler = (configuredManifest?: Manifest) => async () => {
  const database = required('ANALYTICS_DATABASE');
  const bucket = required('ANALYTICS_BUCKET');
  for (const dataset of (configuredManifest ?? manifest()).datasets) {
    const statements = datasetSql(dataset, database, bucket);
    await createTable(statements[0]);
    await addMissingColumns(
      database,
      dataset.historyTable,
      [...generatedColumns(dataset), ...dataset.columns.map(
        (column) =>
          `${quoteIdentifier(column.name)} ${column.type === 'json' ? 'varchar' : column.type}`,
      )],
    );
    await createTable(statements[2]);
    await addMissingColumns(
      database,
      dataset.currentTable,
      [...generatedColumns(dataset), ...dataset.columns.map(
        (column) =>
          `${quoteIdentifier(column.name)} ${column.type === 'json' ? 'varchar' : column.type}`,
      )],
    );
    for (const statement of [statements[1], statements[3]]) {
      await execute(statement);
    }
  }
};

export { datasetSql };
