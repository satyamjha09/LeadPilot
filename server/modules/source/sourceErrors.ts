export class SourceHttpError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'SourceHttpError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class SourceValidationError extends SourceHttpError {
  constructor(message: string, code = 'SOURCE_VALIDATION_ERROR') {
    super(400, code, message);
  }
}

export class SourceUnauthorizedError extends SourceHttpError {
  constructor(message = 'Multi-source admin token is required.') {
    super(401, 'SOURCE_AUTH_MISSING', message);
  }
}

export class SourceForbiddenError extends SourceHttpError {
  constructor(message = 'Multi-source admin token is incorrect.') {
    super(403, 'SOURCE_AUTH_FORBIDDEN', message);
  }
}

export class SourceNotFoundError extends SourceHttpError {
  constructor(message = 'Source not found.', code = 'SOURCE_NOT_FOUND') {
    super(404, code, message);
  }
}

export class SourceConflictError extends SourceHttpError {
  constructor(message: string, code = 'SOURCE_CONFLICT') {
    super(409, code, message);
  }
}

export class SourcePayloadTooLargeError extends SourceHttpError {
  constructor(message = 'Excel file must be 10 MB or smaller.') {
    super(413, 'SOURCE_PAYLOAD_TOO_LARGE', message);
  }
}

export class SourceConfigurationError extends SourceHttpError {
  constructor(message: string) {
    super(503, 'SOURCE_CONFIGURATION_ERROR', message);
  }
}

export function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Request failed.';
}

export function toSourceHttpError(error: unknown) {
  if (error instanceof SourceHttpError) return error;
  if (
    error &&
    typeof error === 'object' &&
    typeof (error as any).statusCode === 'number' &&
    typeof (error as any).code === 'string'
  ) {
    return new SourceHttpError((error as any).statusCode, (error as any).code, safeErrorMessage(error));
  }
  if ((error as any)?.code === 'LIMIT_FILE_SIZE') {
    return new SourcePayloadTooLargeError();
  }
  return new SourceHttpError(500, 'SOURCE_UNEXPECTED_ERROR', safeErrorMessage(error));
}
