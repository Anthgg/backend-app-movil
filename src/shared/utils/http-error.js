function createHttpError(statusCode, errorCode, message, errors = undefined, details = undefined) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.errorCode = errorCode;
  if (errors) error.errors = errors;
  if (details) error.details = details;
  return error;
}

module.exports = { createHttpError };
