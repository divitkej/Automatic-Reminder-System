'use strict';

class AppError extends Error {
  constructor(message, status = 400, details = null) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.details = details;
    this.expose = true;
  }
}

class NotFoundError extends AppError {
  constructor(what = 'Record') {
    super(`${what} not found.`, 404);
    this.name = 'NotFoundError';
  }
}

class ValidationError extends AppError {
  constructor(message, details) {
    super(message || 'The submitted data is not valid.', 422, details);
    this.name = 'ValidationError';
  }
}

class ConflictError extends AppError {
  constructor(message) {
    super(message || 'That conflicts with an existing record.', 409);
    this.name = 'ConflictError';
  }
}

/** Wrap an async express handler so rejections reach the error middleware. */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { AppError, NotFoundError, ValidationError, ConflictError, asyncHandler };
