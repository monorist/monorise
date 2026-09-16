import { createFactory } from 'hono/factory';
import { getDependencies } from '../helpers/dependencies';

const factory = createFactory();

const generalErrorHandler = (dependencies = getDependencies()) =>
  factory.createMiddleware(async (c) => {
    if (c.error) {
      const { nanoid, publishErrorEvent } = dependencies;

      const errorId = nanoid();

      const body = await c.req.json();

      await publishErrorEvent({
        serviceName: 'monorise-core',
        method: c.req.method,
        path: c.req.path,
        id: errorId,
        body,
        error: c.error,
      });

      const error = c.error as any;
      console.warn('[MONORISE_DEBUG] INTERNAL_SERVER_EXCEPTION:', {
        errorId,
        method: c.req.method,
        path: c.req.path,
        errorName: error?.name,
        errorMessage: error?.message,
        errorCode: error?.code,
        errorStack: error?.stack,
        errorConstructor: error?.constructor?.name,
        hasLastError: !!error?.lastError,
        lastErrorName: error?.lastError?.constructor?.name,
        lastErrorMessage: error?.lastError?.message,
        context: error?.context,
      });

      c.status(500);
      c.json({
        code: 'INTERNAL_SERVER_EXCEPTION',
        id: errorId,
      });

      // so lambda monitor able to track error rate
      throw new Error(
        `INTERNAL_SERVER_EXCEPTION: ${errorId}: ${c.req.method} ${c.req.path}: ${c.error}`,
      );
    }
  });

export default generalErrorHandler;
