// utils/error.js — structured application errors

export class AppError extends Error {
  constructor(message, status = 400, code = 'bad_request') {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

export class ValidationError extends AppError {
  constructor(message, fields = {}) {
    super(message, 422, 'validation_error');
    this.fields = fields;
  }
}

export class AuthError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'unauthenticated');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Permission denied') {
    super(message, 403, 'forbidden');
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'not_found');
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource conflict') {
    super(message, 409, 'conflict');
  }
}

export class ExternalError extends AppError {
  constructor(message = 'Upstream service error', status = 502, meta = {}) {
    super(message, status, 'external_error');
    this.meta = meta;
  }
}

export function toErrorResponse(err) {
  if (err instanceof AppError) {
    const body = { message: err.message, code: err.code };
    if (err instanceof ValidationError && err.fields) body.fields = err.fields;
    if (err instanceof ExternalError && err.meta) body.meta = err.meta;
    return { status: err.status, body };
  }
  // Never leak raw internals
  return {
    status: 500,
    body: { message: 'Internal server error', code: 'internal_error' },
  };
}
