import { createMiddleware } from 'hono/factory';
import httpStatus from 'http-status';
import type { ZodError } from 'zod';
import { StandardError, StandardErrorCode } from '../../errors/standard-error';
import type { TransactionService } from '../../services/transaction.service';

export class ExecuteTransactionController {
  constructor(private transactionService: TransactionService) {}

  // biome-ignore lint/suspicious/noExplicitAny: Hono createMiddleware requires consistent return types
  controller = createMiddleware(async (c): Promise<any> => {
    const accountId = c.req.header('account-id') || '';

    try {
      const body = await c.req.json();

      if (!body.operations || !Array.isArray(body.operations)) {
        c.status(httpStatus.BAD_REQUEST);
        return c.json({
          code: 'API_VALIDATION_ERROR',
          message: 'Request body must contain an "operations" array',
        });
      }

      const result = await this.transactionService.executeTransaction(
        body.operations,
        accountId,
      );

      c.status(httpStatus.OK);
      return c.json(result);
    } catch (err) {
      if ((err as ZodError).constructor?.name === 'ZodError') {
        c.status(httpStatus.BAD_REQUEST);
        return c.json({
          code: 'API_VALIDATION_ERROR',
          message: 'Validation failed',
          details: (err as ZodError).flatten(),
        });
      }

      if (err instanceof SyntaxError) {
        c.status(httpStatus.BAD_REQUEST);
        return c.json({
          code: 'API_VALIDATION_ERROR',
          message: 'Request body must be valid JSON',
        });
      }

      if (err instanceof StandardError) {
        const code = err.code;
        // Thrown by getEntity (via Entity.fromItem) when a condition function
        // reads an entity that doesn't exist — same code adjust-entity.controller.ts
        // maps to 404 for the non-transactional path.
        if (
          code === StandardErrorCode.ENTITY_IS_UNDEFINED ||
          code === StandardErrorCode.ENTITY_NOT_FOUND
        ) {
          c.status(httpStatus.NOT_FOUND);
          return c.json({ ...err.toJSON() });
        }

        if (
          code === StandardErrorCode.TRANSACTION_EMPTY ||
          code === StandardErrorCode.TRANSACTION_ITEM_LIMIT_EXCEEDED ||
          code === StandardErrorCode.TRANSACTION_UNIQUE_FIELD_UPDATE ||
          code === StandardErrorCode.TRANSACTION_INVALID_OPERATION ||
          code === StandardErrorCode.TRANSACTION_VALIDATION_ERROR ||
          code === StandardErrorCode.INVALID_ENTITY_TYPE ||
          code === StandardErrorCode.INVALID_CONDITION ||
          code === StandardErrorCode.INVALID_UNIQUE_VALUE_TYPE
        ) {
          c.status(httpStatus.BAD_REQUEST);
          return c.json({ ...err.toJSON() });
        }

        if (
          code === StandardErrorCode.TRANSACTION_FAILED ||
          code === StandardErrorCode.CONDITIONAL_CHECK_FAILED ||
          code === StandardErrorCode.UNIQUE_VALUE_EXISTS
        ) {
          c.status(httpStatus.CONFLICT);
          return c.json({ ...err.toJSON() });
        }
      }

      throw err;
    }
  });
}
