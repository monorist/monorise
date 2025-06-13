export class StandardError extends Error {
  public code: string;
  public lastError?: object | null;
  public context?: string | null;

  constructor(
    errorCode: string,
    message: string,
    lastError?: any,
    context?: object | string | null,
  ) {
    super(message);

    // So you can do typeof CustomError
    Object.setPrototypeOf(this, new.target.prototype);

    this.name = this.constructor.name;
    this.code = errorCode;
    this.lastError = lastError;
    this.context = JSON.stringify(context, null, 2);
  }

  public toJSON() {
    return {
      code: this.code,
      message: this.message,
    };
  }
}

export const StandardErrorCode = {
  CONDITIONAL_CHECK_FAILED: 'CONDITIONAL_CHECK_FAILED',
  EMAIL_EXISTS: 'EMAIL_EXISTS',
  ENTITY_ID_IS_UNDEFINED: 'ENTITY_ID_IS_UNDEFINED',
  ENTITY_IS_UNDEFINED: 'ENTITY_IS_UNDEFINED',
  ENTITY_NOT_FOUND: 'ENTITY_NOT_FOUND',
  INVALID_ENTITY_TYPE: 'INVALID_ENTITY_TYPE',
  INVALID_MUTUAL: 'INVALID_MUTUAL',
  INVALID_QUERY: 'INVALID_QUERY',
  INVALID_UNIQUE_VALUE_TYPE: 'INVALID_UNIQUE_VALUE_TYPE',
  MUTUAL_EXISTS: 'MUTUAL_EXISTS',
  MUTUAL_IS_UNDEFINED: 'MUTUAL_IS_UNDEFINED',
  MUTUAL_LOCK_CONFLICT: 'MUTUAL_LOCK_CONFLICT',
  MUTUAL_NOT_FOUND: 'MUTUAL_NOT_FOUND',
  MUTUAL_PROCESSOR_ERROR: 'MUTUAL_PROCESSOR_ERROR',
  REPLICATION_ERROR: 'REPLICATION_ERROR',
  RETRYABLE_MUTUAL_LOCK_CONFLICT: 'RETRYABLE_MUTUAL_LOCK_CONFLICT',
  TAG_IS_UNDEFINED: 'TAG_IS_UNDEFINED',
  TRANSACTION_FAILED: 'TRANSACTION_FAILED',
  UNIQUE_VALUE_EXISTS: 'UNIQUE_VALUE_EXISTS',
} as const;

export type StandardErrorCode = typeof StandardErrorCode[keyof typeof StandardErrorCode];
