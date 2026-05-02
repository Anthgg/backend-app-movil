require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const runMigrations = async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Conectado a la base de datos.");

    const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
    const files = fs.readdirSync(migrationsDir).sort();

    // Create a simple table to track applied migrations
    await client.query(`
      CREATE TABLE IF NOT EXISTS public._migrations_tracker (
        id serial PRIMARY KEY,
        name varchar(255) UNIQUE NOT NULL,
        executed_at timestamp DEFAULT CURRENT_TIMESTAMP
      )
    `);

    for (const file of files) {
      if (file === '202605020019_add_database_restrictions_rls.sql' || file === '202605020020_fix_missing_rls.sql') {
        const { rows } = await client.query('SELECT name FROM public._migrations_tracker WHERE name = $1', [file]);
        if (rows.length === 0) {
          console.log(`Ejecutando migración: ${file}...`);
          const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
          await client.query(sql);
          await client.query('INSERT INTO public._migrations_tracker (name) VALUES ($1)', [file]);
          console.log(`✅ Migración completada: ${file}`);
        } else {
          console.log(`⏭️ Migración ya aplicada: ${file}`);
        }
      }
    }

    console.log("Todas las migraciones fueron procesadas exitosamente.");
  } catch (error) {
    console.error("Error al correr migraciones:", error);
    process.exit(1);
  } finally {
    await client.end();
  }
};

runMigrations();
