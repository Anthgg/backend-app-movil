const fs = require('fs');
const path = require('path');
const { query } = require('../src/config/database');

const MIGRATIONS_DIR = path.join(__dirname, '../supabase/migrations');

async function runMigrations() {
  console.log('Buscando migraciones...');
  const files = fs.readdirSync(MIGRATIONS_DIR).sort();
  
  // Tabla para registrar migraciones ejecutadas
  await query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version VARCHAR(255) PRIMARY KEY
    );
  `);

  const executedMigrationsRes = await query('SELECT version FROM public.schema_migrations');
  const executedVersions = new Set(executedMigrationsRes.rows.map(r => r.version));

  for (const file of files) {
    const version = file.split('_')[0];
    if (executedVersions.has(version)) {
      // console.log(`- Migración ${file} ya aplicada. Saltando.`);
      continue;
    }

    console.log(`+ Aplicando migración: ${file}`);
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    
    try {
      await query('BEGIN');
      await query(sql);
      await query('INSERT INTO public.schema_migrations (version) VALUES ($1)', [version]);
      await query('COMMIT');
      console.log(`  => Migración ${file} aplicada exitosamente.`);
    } catch (error) {
      await query('ROLLBACK');
      console.error(`  => Error aplicando migración ${file}:`, error.message);
      // Detener si una migración falla
      process.exit(1); 
    }
  }

  console.log('Todas las migraciones nuevas han sido aplicadas.');
}

runMigrations().catch(err => {
  console.error("Error fatal durante el proceso de migración:", err);
  process.exit(1);
});
