const { query } = require('../src/config/database');
const fs = require('fs');
const path = require('path');

async function applyMigration() {
  console.log('Reading migration file...');
  const migrationPath = path.join(__dirname, '../supabase/migrations/202605170002_create_request_templates.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  console.log('Applying migration...');
  try {
    await query(sql);
    console.log('Migration applied successfully!');
  } catch (error) {
    console.error('Error applying migration:', error);
  } finally {
    process.exit(0);
  }
}

applyMigration();
