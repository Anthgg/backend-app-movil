const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.DATABASE_URL
});

async function runMigration() {
  try {
    await client.connect();
    const sql = fs.readFileSync(path.join(__dirname, 'supabase', 'migrations', '202605020022_fix_missing_columns.sql'), 'utf8');
    console.log('Running migration...');
    await client.query(sql);
    console.log('Migration completed successfully.');
  } catch (error) {
    console.error('Error running migration:', error);
  } finally {
    await client.end();
  }
}

runMigration();
