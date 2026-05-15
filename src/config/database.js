const { Pool } = require('pg');
const env = require('./env');
const logger = require('../shared/utils/logger');

const pool = new Pool({
  connectionString: env.databaseUrl,
  ssl: {
    rejectUnauthorized: false
  }
});

const connectDB = async () => {
  try {
    const client = await pool.connect();
    client.release();
    logger.logDatabase('Conexión establecida correctamente con PostgreSQL (Pool inicializado).');
    return true;
  } catch (err) {
    logger.logError('DATABASE', 'Error al conectar el Pool de PostgreSQL', err);
    throw err;
  }
};

const testDatabaseConnection = async () => {
  try {
    const res = await pool.query('SELECT NOW() AS current_time');
    logger.logDatabase('Prueba de conexión exitosa', { server_time: res.rows[0].current_time });
    return res.rows[0];
  } catch (err) {
    logger.logError('DATABASE', 'Prueba de conexión fallida', err);
    throw err;
  }
};

const query = async (text, params) => {
  try {
    const start = Date.now();
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    // logger.logDatabase('Consulta ejecutada', { text, duration, rows: res.rowCount });
    return res;
  } catch (err) {
    logger.logError('DATABASE', 'Error en consulta SQL', err, { text, params });
    throw err;
  }
};

const withTransaction = async (callback) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      logger.logError('DATABASE', 'Error al hacer rollback de transacción', rollbackError);
    }
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  pool,
  query,
  withTransaction,
  connectDB,
  testDatabaseConnection
};
