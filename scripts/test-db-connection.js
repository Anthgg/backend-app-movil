const { Pool } = require('pg');
require('dotenv').config();

async function testConnection() {
  if (!process.env.DATABASE_URL) {
    console.error('Error: DATABASE_URL no está definido en el archivo .env');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    const res = await pool.query('SELECT NOW() AS server_time;');
    console.log('Conexión exitosa a Supabase PostgreSQL');
    console.log(' Hora del servidor PostgreSQL:', res.rows[0].server_time);
  } catch (err) {
    console.error('Error conectando a Supabase PostgreSQL:');
    console.error(err.message);
  } finally {
    await pool.end();
  }
}

testConnection();
