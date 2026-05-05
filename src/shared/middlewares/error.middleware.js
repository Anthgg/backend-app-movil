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

  const statusCode = err.statusCode || 500;
  let message = err.message || 'Error interno del servidor';

  // En producción, no devolver errores crudos (como errores de SQL)
  if (env.nodeEnv === 'production' && statusCode === 500) {
    message = 'Error interno del servidor';
  }

  const response = {
    success: false,
    message,
    error_code: err.errorCode || 'INTERNAL_SERVER_ERROR'
  };

  if (env.nodeEnv === 'development' && statusCode === 500) {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
};

module.exports = errorHandler;
