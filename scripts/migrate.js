const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

async function runMigrations() {
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('TU_PASSWORD_REAL')) {
    console.error('❌ Error: Debes colocar tu contraseña real en DATABASE_URL dentro del archivo .env');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
  
  try {
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort(); // Ejecutar en orden alfabético

    console.log(`⏳ Encontrados ${files.length} archivos de migración.`);

    for (const file of files) {
      console.log(`\n▶ Ejecutando: ${file}...`);
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      // Ejecutar el SQL de cada archivo
      await pool.query(sql);
      console.log(`✅ Completado: ${file}`);
    }

    console.log('\n🎉 ¡Todas las migraciones se ejecutaron correctamente en Supabase!');
  } catch (err) {
    console.error('\n❌ Error ejecutando migraciones:', err.message);
  } finally {
    await pool.end();
  }
}

runMigrations();
