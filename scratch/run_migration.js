const { query } = require('../src/config/database');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  try {
    const migrationPath = path.join(__dirname, '..', 'supabase/migrations/20260507160000_add_shifts_and_advanced_attendance.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('Ejecutando migración...');
    await query(sql);
    console.log('Migración completada con éxito.');
    process.exit(0);
  } catch (err) {
    console.error('Error ejecutando migración:', err);
    process.exit(1);
  }
}

runMigration();
