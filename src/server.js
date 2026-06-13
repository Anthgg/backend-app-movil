require('dns').setDefaultResultOrder('ipv4first');

const env = require('./config/env');

console.log('Iniciando backend-app-movil...');
console.log('NODE_ENV:', env.nodeEnv);
console.log('PORT:', env.port);

const app = require('./app');
const { connectDB } = require('./config/database');
const { testSupabaseConnection } = require('./config/supabase');
const logger = require('./shared/utils/logger');

let server;

const sessionService = require('./services/profile-service/session.service');

const bootstrap = async () => {
  env.validateEnv();

  await connectDB();
  await testSupabaseConnection();

  // Run cleanup of obsolete sessions
  try {
    await sessionService.cleanupObsoleteSessions();
  } catch (cleanupError) {
    logger.logError('SYSTEM', 'Error durante la limpieza de sesiones obsoletas', cleanupError);
  }

  // Run backfill of sessions in background (non-blocking)
  sessionService.runSessionsBackfill().catch((backfillError) => {
    logger.logError('SYSTEM', 'Error durante el backfill de sesiones en background', backfillError);
  });

  server = app.listen(env.port, '0.0.0.0', () => {
    logger.logInfo('SYSTEM', `Servidor iniciado en puerto ${env.port} en modo ${env.nodeEnv}`);
    console.log(`Servidor corriendo en puerto ${env.port}`);
  });
};

bootstrap().catch((error) => {
  logger.logError('SYSTEM', 'Error durante la inicializacion de servicios', error);
  console.error('Error durante la inicializacion de servicios:', error.message);
  process.exit(1);
});

// Manejo de cierres limpios
process.on('SIGTERM', () => {
  logger.logInfo('SYSTEM', 'SIGTERM recibido, cerrando servidor limpiamente...');

  if (!server) {
    process.exit(0);
  }

  server.close(() => {
    logger.logInfo('SYSTEM', 'Servidor HTTP cerrado');
    process.exit(0);
  });
});
