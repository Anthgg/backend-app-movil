console.log('Iniciando backend-app-movil...');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('PORT:', process.env.PORT);

const app = require('./app');
const env = require('./config/env');
const { connectDB } = require('./config/database');
const { testSupabaseConnection } = require('./config/supabase');
const logger = require('./shared/utils/logger');

const PORT = process.env.PORT || 8080;
const server = app.listen(PORT, '0.0.0.0', () => {
  logger.logInfo('SYSTEM', `Servidor iniciado en puerto ${PORT} en modo ${env.nodeEnv}`);
  console.log(`Servidor corriendo en puerto ${PORT}`);
});

const initializeServices = async () => {
  try {
    env.validateEnv();

    await connectDB();
    await testSupabaseConnection();

  } catch (error) {
    logger.logError('SYSTEM', 'Error durante la inicialización de servicios', error);
    console.error('Error durante la inicialización de servicios:', error.message);
  }
};

initializeServices();

// Manejo de cierres limpios
process.on('SIGTERM', () => {
  logger.logInfo('SYSTEM', 'SIGTERM recibido, cerrando servidor limpiamente...');
  server.close(() => {
    logger.logInfo('SYSTEM', 'Servidor HTTP cerrado');
    process.exit(0);
  });
});
