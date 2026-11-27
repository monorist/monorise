import type { ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { getDependencies } from '../helpers/dependencies';

/**
 * Hono's error handler: answers an error no controller handled. It logs the
 * error with an ID and answers 500 with that ID, so a client can quote it
 * and the log line can be found.
 */
const generalErrorHandler =
  (dependencies = getDependencies()): ErrorHandler =>
  (err, c) => {
    // Hono's own errors, such as malformed JSON, carry their response.
    if (err instanceof HTTPException) return err.getResponse();

    const errorId = dependencies.nanoid();
    // biome-ignore lint/suspicious/noExplicitAny: reads optional fields some errors carry
    const error = err as any;
    console.warn('[MONORISE_DEBUG] INTERNAL_SERVER_EXCEPTION:', {
      errorId,
      method: c.req.method,
      path: c.req.path,
      apiKeyPolicy: c.get('apiKey')?.policy,
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

    return c.json({ code: 'INTERNAL_SERVER_EXCEPTION', id: errorId }, 500);
  };

export default generalErrorHandler;
