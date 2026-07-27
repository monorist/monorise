import { AthenaClient, GetQueryExecutionCommand, StartQueryExecutionCommand } from '@aws-sdk/client-athena';

const athena = new AthenaClient();

type Model = {
  name: string;
  sql: string;
  partitionColumn: string;
  lookbackDays: number;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function quote(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function execute(statement: string) {
  const started = await athena.send(new StartQueryExecutionCommand({
    QueryString: statement,
    WorkGroup: required('ANALYTICS_WORKGROUP'),
    QueryExecutionContext: { Database: required('ANALYTICS_DATABASE') },
    ResultConfiguration: { OutputLocation: required('ANALYTICS_ATHENA_OUTPUT') },
  }));
  if (!started.QueryExecutionId) throw new Error('Athena did not return a query execution id.');
  for (;;) {
    const status = (await athena.send(new GetQueryExecutionCommand({ QueryExecutionId: started.QueryExecutionId }))).QueryExecution?.Status;
    if (status?.State === 'SUCCEEDED') return;
    if (status?.State === 'FAILED' || status?.State === 'CANCELLED') throw new Error(`Analytics model ${status.State}: ${status.StateChangeReason ?? 'no reason provided'}`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

export function modelStatements(model: Model, database: string, bucket: string, now = new Date()): string[] {
  const table = model.name.replaceAll('-', '_');
  const end = now;
  const start = new Date(end.getTime() - model.lookbackDays * 86_400_000);
  const source = model.sql
    .replaceAll('{{windowStart}}', `'${start.toISOString().replaceAll("'", "''")}'`)
    .replaceAll('{{windowEnd}}', `'${end.toISOString().replaceAll("'", "''")}'`);
  const target = `${quote(database)}.${quote(table)}`;
  const location = `s3://${bucket}/models/${table}/`;
  const partitionStart = start.toISOString().slice(0, 10);
  return [
    `CREATE TABLE IF NOT EXISTS ${target} WITH (table_type = 'ICEBERG', location = '${location}', partitioning = ARRAY['${model.partitionColumn}']) AS ${source}`,
    `DELETE FROM ${target} WHERE ${quote(model.partitionColumn)} >= DATE '${partitionStart}'`,
    `INSERT INTO ${target} ${source}`,
  ];
}

export const handler = async () => {
  const model = JSON.parse(required('ANALYTICS_MODEL')) as Model;
  for (const statement of modelStatements(model, required('ANALYTICS_DATABASE'), required('ANALYTICS_BUCKET'))) {
    await execute(statement);
  }
};
