const { query, pool } = require('./src/config/database');

(async () => {
  try {
    await query("DELETE FROM public.schema_migrations WHERE version >= '20260504031000'");
    console.log('Migraciones nuevas eliminadas del registro.');
    await pool.end();
  } catch (err) {
    console.error('Error:', err.message);
    await pool.end();
    process.exit(1);
  }
})();
