const logger = require('../utils/logger');
const env = require('../../config/env');

const errorHandler = (err, req, res, next) => {
  logger.logError('SYSTEM', `Error en petición: ${req.method} ${req.url}`, err, {
    ip: req.ip,
    body: req.body,
    params: req.params,
    query: req.query,
    user_id: req.user?.id
  });

  if (err.code === 'LIMIT_FILE_SIZE') {
    err.statusCode = 413;
    err.errorCode = 'FILE_TOO_LARGE';
    err.message = 'El archivo supera el tamaño máximo permitido.';
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    err.statusCode = 400;
    err.errorCode = 'INVALID_FILE_FIELD';
    err.message = 'Campo de archivo no esperado.';
  }

  const statusCode = parseInt(err.statusCode, 10) || 500;
  let message = err.message || 'Error interno del servidor';

  // TEMPORAL PARA DEBUG: Comentamos la ocultación de errores en producción
  /* 
  if (env.nodeEnv === 'production' && statusCode === 500) {
    message = 'Error interno del servidor';
  }
  */

  const response = {
    success: false,
    message,
    error_code: err.errorCode || 'INTERNAL_SERVER_ERROR',
    code: err.errorCode || 'INTERNAL_SERVER_ERROR',
    errorCode: err.errorCode || 'INTERNAL_SERVER_ERROR',
    error: {
      code: err.errorCode || 'INTERNAL_SERVER_ERROR',
      details: err.details || err.errors || []
    }
  };

  if (err.errors) {
    response.errors = err.errors;
  }

  // TEMPORAL PARA DEBUG: Siempre devolver el stack en errores 500
  if (statusCode === 500) {
    response.stack = err.stack;
    response.debug_message = err.message;
  }

  res.status(statusCode).json(response);
};

module.exports = errorHandler;
