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
