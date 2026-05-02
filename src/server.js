const http = require('http');
const app = require('./app');
const env = require('./config/env');
const { connectDB } = require('./config/database');
const { testSupabaseConnection } = require('./config/supabase');
const logger = require('./shared/utils/logger');

const server = http.createServer(app);

const startServer = async () => {
  try {
    // 1. Validar variables de entorno
    env.validateEnv();
    
    // 2. Conectar y probar BD
    await connectDB();
    
    // 3. Probar conexión Supabase
    await testSupabaseConnection();

    // 4. Iniciar servidor
    const PORT = process.env.PORT || env.port || 3000;
    server.listen(PORT, "0.0.0.0", () => {
      logger.logInfo('SYSTEM', `Servidor iniciado en puerto ${PORT} en modo ${env.nodeEnv}`);
      console.log(`🚀 Servidor ejecutándose en http://0.0.0.0:${PORT}`);
    });

  } catch (error) {
    logger.logError('SYSTEM', 'Error crítico al iniciar el servidor', error);
    console.error('❌ Error crítico al iniciar el servidor:', error.message);
    process.exit(1);
  }
};

// Manejo de cierres limpios
process.on('SIGTERM', () => {
  logger.logInfo('SYSTEM', 'SIGTERM recibido, cerrando servidor limpiamente...');
  server.close(() => {
    logger.logInfo('SYSTEM', 'Servidor HTTP cerrado');
    process.exit(0);
  });
});

startServer();
