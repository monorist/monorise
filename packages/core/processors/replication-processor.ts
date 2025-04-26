import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import type {
  AttributeValue,
  _Record as DynamoDBStreamEvent,
} from '@aws-sdk/client-dynamodb-streams';
import type { DynamoDBBatchItemFailure } from 'aws-lambda';
import {
  ENTITY_REPLICATION_INDEX,
  MUTUAL_REPLICATION_INDEX,
} from '../configs/service.config';
import { StandardError } from '../errors/standard-error';
import type { DependencyContainer } from '../services/DependencyContainer';

export const handler =
  (container: DependencyContainer) =>
  async (event: { Records: DynamoDBStreamEvent[] }) => {
    const TableName = process.env.DDB_TABLE || container.coreTable;
    const batchItemFailures: DynamoDBBatchItemFailure[] = [];
    const { dynamodbClient } = container;

    for (const record of event.Records) {
      const errorContext: any = {};
      errorContext.record = record;

      try {
        if (record.eventName === 'MODIFY') {
          const modifiedItem = record.dynamodb?.NewImage;
          if (!modifiedItem) {
            continue;
          }

          const isMetadata = modifiedItem.SK.S?.startsWith('#METADATA#');
          const isMutual =
            modifiedItem.PK.S?.startsWith('MUTUAL#') && isMetadata;
          const isEntity = isMetadata && !isMutual;

          if (!isEntity && !isMutual) {
            // skip replicated data
            continue;
          }

          // default variables
          let targetRPK = 'R1PK';
          const targetData = 'data';
          let targetIndexName = ENTITY_REPLICATION_INDEX;
          const targetUpdatedAt = 'updatedAt';

          let queryExpression: {
            FilterExpression?: string;
            ExpressionAttributeNames: Record<string, string>;
            ExpressionAttributeValues: Record<string, AttributeValue>;
          } = {
            FilterExpression: `#${targetUpdatedAt} < :${targetUpdatedAt}`,
            ExpressionAttributeNames: {
              [`#${targetRPK}`]: targetRPK,
              [`#${targetUpdatedAt}`]: targetUpdatedAt,
            },
            ExpressionAttributeValues: {
              [`:${targetRPK}`]: modifiedItem.PK,
              [`:${targetUpdatedAt}`]: modifiedItem.updatedAt,
            },
          };

          const updateExpession: {
            ConditionExpression: string;
            UpdateExpression: string;
            ExpressionAttributeNames: Record<string, string>;
            ExpressionAttributeValues: Record<string, AttributeValue>;
          } = {
            UpdateExpression: `SET #${targetUpdatedAt} = :${targetUpdatedAt}, #${targetData} = :${targetData}`,
            ConditionExpression: `#${targetUpdatedAt} < :${targetUpdatedAt}`,
            ExpressionAttributeNames: {
              [`#${targetData}`]: targetData,
              [`#${targetUpdatedAt}`]: targetUpdatedAt,
            },
            ExpressionAttributeValues: {
              [`:${targetData}`]: modifiedItem.data,
              [`:${targetUpdatedAt}`]: modifiedItem.updatedAt,
            },
          };

          if (isMutual) {
            targetRPK = 'R2PK';
            targetIndexName = MUTUAL_REPLICATION_INDEX;

            // condition to only replicate to mutualAsEntity
            queryExpression = {
              FilterExpression: `${queryExpression.FilterExpression} AND #SK = :metadata`, // to replicate to mutualAsEntity only
              ExpressionAttributeNames: {
                '#SK': 'SK',
                [`#${targetRPK}`]: targetRPK,
                [`#${targetUpdatedAt}`]: targetUpdatedAt,
              },
              ExpressionAttributeValues: {
                ':metadata': { S: '#METADATA#' },
                [`:${targetRPK}`]: modifiedItem.PK,
                [`:${targetUpdatedAt}`]: modifiedItem.mutualUpdatedAt,
              },
            };

            updateExpession.ExpressionAttributeValues = {
              [`:${targetData}`]: modifiedItem.mutualData,
              [`:${targetUpdatedAt}`]: modifiedItem.mutualUpdatedAt,
            };
          }

          errorContext.queryExpression = queryExpression;
          errorContext.updateExpession = updateExpession;

          // retrieve all to be replicated items
          let toBeReplicatedItems: Record<string, AttributeValue>[] = [];
          let lastKey;

          do {
            const queryResult = await dynamodbClient.query({
              TableName,
              IndexName: targetIndexName,
              KeyConditionExpression: `#${targetRPK} = :${targetRPK}`,
              ...queryExpression,
            });

            toBeReplicatedItems = [
              ...toBeReplicatedItems,
              ...(queryResult.Items || []),
            ];
            lastKey = queryResult.LastEvaluatedKey;
          } while (lastKey);
          errorContext.toBeReplicatedItems = toBeReplicatedItems;

          const updatePromises = toBeReplicatedItems.map((item) => {
            const updateParams = {
              TableName,
              Key: {
                PK: item.PK,
                SK: item.SK,
              },
              ...updateExpession,
            };

            return dynamodbClient.updateItem(updateParams);
          });

          const results = await Promise.allSettled(updatePromises);
          errorContext.results = results;

          if (
            results.some(
              (result) =>
                result.status === 'rejected' &&
                !(result.reason instanceof ConditionalCheckFailedException),
            )
          ) {
            throw new StandardError(
              'REPLICATION_ERROR',
              'Replication error',
              null,
              errorContext,
            );
          }
        }

        if (record.eventName === 'REMOVE') {
          const removedKeys = record.dynamodb?.Keys || {};
          const isMetadata = removedKeys.SK.S?.startsWith('#METADATA#');
          const isMutual =
            removedKeys.PK.S?.startsWith('MUTUAL#') && isMetadata;
          const isEntity = isMetadata && !isMutual;

          if (!isEntity && !isMutual) {
            continue;
          }

          // default query settings
          let targetRPK = 'R1PK';
          let targetIndexName: string = ENTITY_REPLICATION_INDEX;

          if (isMutual) {
            targetRPK = 'R2PK';
            targetIndexName = MUTUAL_REPLICATION_INDEX;
          }

          let itemsToDelete: Record<string, AttributeValue>[] = [];
          let lastKey;

          do {
            const queryResult = await dynamodbClient.query({
              TableName,
              IndexName: targetIndexName,
              KeyConditionExpression: `#${targetRPK} = :${targetRPK}`,
              ExpressionAttributeNames: {
                [`#${targetRPK}`]: targetRPK,
              },
              ExpressionAttributeValues: {
                [`:${targetRPK}`]: removedKeys.PK,
              },
            });

            itemsToDelete = [...itemsToDelete, ...(queryResult.Items || [])];
            lastKey = queryResult.LastEvaluatedKey;
          } while (lastKey);

          const mutualsToDelete = Array.from(
            new Set(
              itemsToDelete
                .filter((item) => item.R2PK?.S?.startsWith('MUTUAL#'))
                .map((filteredItem) => filteredItem.R2PK?.S),
            ),
          );
          mutualsToDelete.forEach((mutual) => {
            if (!mutual) {
              return;
            }

            itemsToDelete.push({ PK: { S: mutual }, SK: { S: '#METADATA#' } });
          });

          const deleteResults = await Promise.allSettled(
            itemsToDelete.map((item) =>
              dynamodbClient.deleteItem({
                TableName,
                Key: {
                  PK: item.PK,
                  SK: item.SK,
                },
              }),
            ),
          );
          errorContext.deleteResults = deleteResults;

          if (
            deleteResults.some(
              (result) =>
                result.status === 'rejected' &&
                !(result.reason instanceof ConditionalCheckFailedException),
            )
          ) {
            throw new StandardError(
              'REPLICATION_ERROR',
              'Replication error',
              null,
              errorContext,
            );
          }
        }
      } catch (error) {
        console.error('====REPLICATION_ERROR', error);
        console.log(
          '====REPLICATION_ERROR errorContext',
          JSON.stringify(errorContext, null, 2),
        );

        batchItemFailures.push({
          itemIdentifier: record.dynamodb?.SequenceNumber || '',
        });

        // immediately return to prevent processing the rest
        // because stream will restart from this point again
        return { batchItemFailures };
      }
    }

    return { batchItemFailures };
  };
