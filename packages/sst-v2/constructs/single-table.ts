import { StartingPosition } from 'aws-cdk-lib/aws-lambda';
import { SqsDlq } from 'aws-cdk-lib/aws-lambda-event-sources';
import type { Construct } from 'constructs';
import {
  Function,
  type FunctionProps,
  Queue,
  Table,
  type TableProps,
} from 'sst/constructs';
import {
  ENTITY_REPLICATION_INDEX,
  MUTUAL_REPLICATION_INDEX,
} from '../constants/table';

export class SingleTable {
  public readonly id: string;
  public readonly table: Table;
  private dlq: Queue;

  constructor(
    scope: Construct,
    id: string,
    {
      tableProps,
      funcProps,
    }: { tableProps?: TableProps; funcProps?: FunctionProps },
  ) {
    this.id = id;
    this.dlq = new Queue(scope, `${id}-queue-dlq`);
    this.table = new Table(scope, id, {
      fields: {
        PK: 'string',
        SK: 'string',
        R1PK: 'string',
        R1SK: 'string',
        R2PK: 'string',
        R2SK: 'string',
        ...tableProps?.fields,
      },
      primaryIndex: { partitionKey: 'PK', sortKey: 'SK' },
      globalIndexes: {
        [ENTITY_REPLICATION_INDEX]: {
          partitionKey: 'R1PK',
          sortKey: 'R1SK',
          projection: [
            'PK',
            'SK',
            'R2PK',
            'R2SK',
            'updatedAt',
            'mutualUpdatedAt',
          ],
        },
        [MUTUAL_REPLICATION_INDEX]: {
          partitionKey: 'R2PK',
          sortKey: 'R2SK',
          projection: [
            'PK',
            'SK',
            'R2PK',
            'R2SK',
            'updatedAt',
            'mutualUpdatedAt',
          ],
        },
        ...tableProps?.globalIndexes,
      },
      stream: true,
      timeToLiveAttribute: tableProps?.timeToLiveAttribute,
      cdk: {
        table: {
          deletionProtection: true,
        },
      },
    });

    /*
     * Lambda envs
     */
    const environment = {
      DDB_TABLE: this.table.tableName,
    };

    /*
     * Replication processor
     */
    this.table.addConsumers(scope, {
      ddbReplicator: {
        function: new Function(scope, `${id}-replicator`, {
          timeout: '60 seconds',
          memorySize: '512 MB',
          environment,
          ...funcProps,
        }),
        cdk: {
          eventSource: {
            startingPosition: StartingPosition.LATEST,
            reportBatchItemFailures: true,
            retryAttempts: 1,
            onFailure: new SqsDlq(this.dlq.cdk.queue),
          },
        },
      },
    });

    this.table.bind([this.table]);
  }
}
