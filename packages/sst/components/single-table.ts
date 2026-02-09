import path from 'node:path';
import {
  ENTITY_REPLICATION_INDEX,
  MUTUAL_REPLICATION_INDEX,
} from '../constants/table';

type SingleTableArgs = {
  ttl?: string;
  runtime?: sst.aws.FunctionArgs['runtime'];
  configRoot?: string;
};

export class SingleTable {
  public readonly id: string;
  public readonly table: sst.aws.Dynamo;
  private dlq: sst.aws.Queue;

  constructor(id: string, args?: SingleTableArgs) {
    this.id = id;
    this.dlq = new sst.aws.Queue(`${id}-core-replicator-dlq`);
    this.table = new sst.aws.Dynamo(`${id}-core-table`, {
      fields: {
        PK: 'string',
        SK: 'string',
        R1PK: 'string',
        R1SK: 'string',
        R2PK: 'string',
        R2SK: 'string',
      },
      primaryIndex: { hashKey: 'PK', rangeKey: 'SK' },
      globalIndexes: {
        [ENTITY_REPLICATION_INDEX]: {
          hashKey: 'R1PK',
          rangeKey: 'R1SK',
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
          hashKey: 'R2PK',
          rangeKey: 'R2SK',
          projection: [
            'PK',
            'SK',
            'R2PK',
            'R2SK',
            'updatedAt',
            'mutualUpdatedAt',
          ],
        },
      },
      stream: 'new-and-old-images',
      ttl: args?.ttl,
    });

    const environment = {
      CORE_TABLE: this.table.name,
    };

    this.table.subscribe(
      `${id}-core-replicator`,
      {
        handler: path.join(
          args?.configRoot ?? '',
          '.monorise/handle.replicationHandler',
        ),
        timeout: '60 seconds',
        memory: '512 MB',
        runtime: args?.runtime,
        environment,
        link: [this.table, this.dlq],
      },
      {
        transform: {
          eventSourceMapping: {
            startingPosition: 'LATEST',
            bisectBatchOnFunctionError: true,
            maximumRetryAttempts: 1,
            destinationConfig: {
              onFailure: {
                destinationArn: this.dlq.arn,
              },
            },
          },
        },
      },
    );
  }
}
