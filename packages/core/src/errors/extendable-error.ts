class ExtendableError extends Error {
  public name: string;
  public message: string;
  public errors: any;
  public status: number;
  public isPublic: boolean;
  public isOperational: boolean;
  public stack?: string;

  constructor({
    message,
    errors,
    status,
    isPublic,
    stack,
  }: {
    message: string;
    errors?: any;
    status?: number;
    isPublic?: boolean;
    stack?: string;
  }) {
    super(message);
    this.name = this.constructor.name;
    this.message = message;
    this.errors = errors;
    this.status = status || 500; // Default value if status is not provided
    this.isPublic = isPublic || false; // Default value if isPublic is not provided
    this.isOperational = true; // This is required since bluebird 4 doesn't append it anymore.
    this.stack = stack;
    // Error.captureStackTrace(this, this.constructor.name);
  }
}

export default ExtendableError;
