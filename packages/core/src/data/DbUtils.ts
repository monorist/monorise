import {
  BatchStatementErrorCodeEnum,
  type DynamoDB,
  type TransactWriteItemsInput,
  TransactionCanceledException,
} from '@aws-sdk/client-dynamodb';
import { StandardError, StandardErrorCode } from '../errors/standard-error';

export class DbUtils {
  constructor(private ddbClient: DynamoDB) {}

  async executeTransactWrite(params: TransactWriteItemsInput) {
    try {
      await this.ddbClient.transactWriteItems(params);
    } catch (err) {
      if (err instanceof TransactionCanceledException) {
        const hasConditionalCheckFailed = err.CancellationReasons?.some(
          (reason) =>
            reason.Code === BatchStatementErrorCodeEnum.ConditionalCheckFailed,
        );

        if (hasConditionalCheckFailed) {
          throw new StandardError(
            StandardErrorCode.CONDITIONAL_CHECK_FAILED,
            'Failed to executeTransactWrite',
            err,
            { params },
          );
        }
      }

      throw new StandardError(
        StandardErrorCode.TRANSACTION_FAILED,
        'Failed to executeTransactWrite',
        err,
        { params },
      );
    }
  }
}
