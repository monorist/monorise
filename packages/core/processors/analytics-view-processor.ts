import { AthenaClient, GetQueryExecutionCommand, StartQueryExecutionCommand } from '@aws-sdk/client-athena';

const athena = new AthenaClient();

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function quote(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export const handler = async () => {
  const view = JSON.parse(required('ANALYTICS_VIEW')) as { name: string; sql: string };
  const started = await athena.send(new StartQueryExecutionCommand({
    QueryString: `CREATE OR REPLACE VIEW ${quote(required('ANALYTICS_DATABASE'))}.${quote(view.name.replaceAll('-', '_'))} AS ${view.sql}`,
    WorkGroup: required('ANALYTICS_WORKGROUP'),
    QueryExecutionContext: { Database: required('ANALYTICS_DATABASE') },
    ResultConfiguration: { OutputLocation: required('ANALYTICS_ATHENA_OUTPUT') },
  }));
  if (!started.QueryExecutionId) throw new Error('Athena did not return a query execution id.');
  for (;;) {
    const status = (await athena.send(new GetQueryExecutionCommand({ QueryExecutionId: started.QueryExecutionId }))).QueryExecution?.Status;
    if (status?.State === 'SUCCEEDED') return;
    if (status?.State === 'FAILED' || status?.State === 'CANCELLED') {
      throw new Error(`Analytics view ${view.name} ${status.State}: ${status.StateChangeReason ?? 'no reason provided'}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
};
