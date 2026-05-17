const fs = require('fs');
const path = require('path');
const winston = require('winston');
require('winston-daily-rotate-file');

const isProduction = process.env.NODE_ENV === 'production';
const logDir = path.join(process.cwd(), 'logs');

// Crear directorios de logs si no existen (solo en desarrollo)
const logCategories = ['errors', 'changes', 'database', 'auth', 'attendance', 'requests', 'documents', 'system'];
if (!isProduction) {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
  }
  logCategories.forEach(category => {
    const dirPath = path.join(logDir, category);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath);
    }
  });
}

// Formato personalizado para los logs
const customFormat = winston.format.printf(({ level, message, timestamp, module, ...metadata }) => {
  // Limpiar secrets en producción
  if (metadata) {
    ['password', 'jwt_secret', 'jwt_refresh_secret', 'cron_secret', 'database_url', 'token'].forEach(key => {
      if (metadata[key]) metadata[key] = '***';
    });
  }
  
  let metaStr = '';
  if (Object.keys(metadata).length > 0) {
    metaStr = ' | ' + Object.entries(metadata).map(([k, v]) => `${k}=${v}`).join(' | ');
  }
  return `[${timestamp}] [${level.toUpperCase()}] [${module || 'SYSTEM'}] ${message}${metaStr}`;
});

const getTransport = (category) => {
  if (isProduction) return null; // No crear archivos en producción
  return new winston.transports.DailyRotateFile({
    filename: path.join(logDir, category, '%DATE%-' + category + '.log'),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: false,
    maxSize: '20m',
    maxFiles: '14d'
  });
};

const buildTransports = (category) => {
  const transports = [new winston.transports.Console()];
  const fileTransport = getTransport(category);
  if (fileTransport) transports.push(fileTransport);
  return transports;
};

const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    customFormat
  ),
  transports: buildTransports('system')
});

// Logger categories
const errorLogger = winston.createLogger({
  format: winston.format.combine(winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), customFormat),
  transports: buildTransports('errors')
});

const changeLogger = winston.createLogger({
  format: winston.format.combine(winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), customFormat),
  transports: buildTransports('changes')
});

const dbLogger = winston.createLogger({
  format: winston.format.combine(winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), customFormat),
  transports: buildTransports('database')
});

const authLogger = winston.createLogger({
  format: winston.format.combine(winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), customFormat),
  transports: buildTransports('auth')
});

module.exports = {
  logInfo: (module, message, metadata = {}) => {
    logger.info({ message, module, ...metadata });
  },
  logError: (module, message, error, metadata = {}) => {
    let errorDetails = '';
    if (error) {
      if (typeof error === 'string') {
        errorDetails = error;
      } else if (error instanceof Error) {
        errorDetails = error.message;
      } else {
        try {
          errorDetails = JSON.stringify(error);
        } catch (e) {
          errorDetails = String(error);
        }
      }
    }
    errorLogger.error({ message: `${message} - ${errorDetails}`, module, ...metadata, stack: error?.stack });
  },
  logChange: (module, message, metadata = {}) => {
    changeLogger.info({ message, module, ...metadata, level: 'change' }); // usando info como base pero en el archivo change
  },
  logWarn: (module, message, metadata = {}) => {
    logger.warn({ message, module, ...metadata });
  },
  logDatabase: (message, metadata = {}) => {
    dbLogger.info({ message, module: 'DATABASE', ...metadata });
  },
  logAuth: (message, metadata = {}) => {
    authLogger.info({ message, module: 'AUTH', ...metadata });
  }
};
