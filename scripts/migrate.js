const fs = require('fs');
const path = require('path');
const { query, pool } = require('../src/config/database');

const MIGRATIONS_DIR = path.join(__dirname, '../supabase/migrations');

// A simple map to know which key table each migration creates.
// This helps to sync the state if the migrations table was lost.
const MIGRATION_TABLE_MAP = {
  '202605020001': 'roles',
  '202605020002': 'refresh_tokens',
  '202605020003': 'companies',
  '202605020004': 'attendance_records',
  '202605020005': 'request_types', // Corregido de 'requests'
  '202605020006': 'payroll_periods',
  '202605020007': 'roles', // RLS policies, check first table
  '202605020008': 'roles', // Seed data, check first table
  '202605020009': 'users', // More RLS
  '202605020010': 'refresh_tokens', // More RLS
  '202605020011': 'users', // Soft deletes
  '202605020012': 'user_devices',
  '202605020013': 'permissions', // Sprint 2 permissions
  '202605020014': 'attendance_records', // Sprint 3 attendance
  '202605020015': 'job_runs', // Sprint 3.5 jobs
  '202605020016': 'requests', // Sprint 4 requests
  '202605020017': 'generated_reports', // Sprint 5 reports
  '202605020018': 'payroll_periods', // Sprint 6 payroll
  '202605020019': 'users', // DB restrictions
  '202605020020': 'users', // Fix RLS
  '202605020021': 'workers', // Formalize schema
};

async function tableExists(tableName) {
  const res = await query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public'
      AND table_name = $1
    );
  `, [tableName]);
  return res.rows[0].exists;
}

async function runMigrations() {
  console.log('Iniciando proceso de migración...');
  
  // 1. Ensure the migrations table exists
  await query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version VARCHAR(255) PRIMARY KEY
    );
  `);
  console.log('Tabla `schema_migrations` asegurada.');

  const allMigrationFiles = fs.readdirSync(MIGRATIONS_DIR).sort();
  const executedMigrationsRes = await query('SELECT version FROM public.schema_migrations');
  const executedVersions = new Set(executedMigrationsRes.rows.map(r => r.version));

  // 2. Sync state: if a table from a migration exists but is not in the registry, add it.
  console.log('Sincronizando estado de migraciones existentes...');
  for (const versionPrefix in MIGRATION_TABLE_MAP) {
    if (!executedVersions.has(versionPrefix)) {
      const tableName = MIGRATION_TABLE_MAP[versionPrefix];
      if (await tableExists(tableName)) {
        console.log(`  - La tabla '${tableName}' existe. Marcando migración ${versionPrefix} como aplicada.`);
        await query('INSERT INTO public.schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING', [versionPrefix]);
        executedVersions.add(versionPrefix);
      }
    }
  }
  console.log('Sincronización completa.');

  // 3. Apply new migrations
  console.log('Buscando y aplicando migraciones nuevas...');
  let newMigrationsApplied = 0;
  for (const file of allMigrationFiles) {
    const version = file.match(/^\d+/)?.[0];
    if (version && !executedVersions.has(version)) {
      console.log(`+ Aplicando nueva migración: ${file}`);
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
      
      try {
        await query('BEGIN');
        await query(sql);
        await query('INSERT INTO public.schema_migrations (version) VALUES ($1)', [version]);
        await query('COMMIT');
        console.log(`  => Migración ${file} aplicada exitosamente.`);
        newMigrationsApplied++;
      } catch (error) {
        await query('ROLLBACK');
        console.error(`  => ERROR aplicando migración ${file}:`, error.message);
        console.error("Detalle del error:", error);
        // Stop if a migration fails
        await pool.end();
        process.exit(1); 
      }
    }
  }

  if (newMigrationsApplied === 0) {
    console.log('No hay migraciones nuevas que aplicar. La base de datos está actualizada.');
  } else {
    console.log(`Proceso finalizado. Se aplicaron ${newMigrationsApplied} migraciones nuevas.`);
  }
  
  await pool.end();
}

runMigrations().catch(async err => {
  console.error("Error fatal durante el proceso de migración:", err);
  await pool.end();
  process.exit(1);
});
