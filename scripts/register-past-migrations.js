const fs = require('fs');
const path = require('path');
const { query } = require('../src/config/database');

const MIGRATIONS_DIR = path.join(__dirname, '../supabase/migrations');

async function registerMigrations() {
  console.log('Creando tabla schema_migrations si no existe...');
  await query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version VARCHAR(255) PRIMARY KEY
    );
  `);

  console.log('Leyendo archivos de migración...');
  const files = fs.readdirSync(MIGRATIONS_DIR).sort();

  for (const file of files) {
    const version = file.split('_')[0];
    if (version === '202605180001') {
      // No registrar la nueva para que sí se ejecute
      continue;
    }

    try {
      await query('INSERT INTO public.schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING', [version]);
      console.log(`Registrada versión: ${version}`);
    } catch (err) {
      console.error(`Error registrando versión ${version}:`, err.message);
    }
  }

  console.log('Registro completado.');
}

registerMigrations().catch(err => {
  console.error(err);
  process.exit(1);
});
