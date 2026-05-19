const { query } = require('../src/config/database');

(async () => {
  try {
    const res = await query(`
      SELECT conname, pg_get_constraintdef(c.oid)
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE conrelid = 'public.request_documents'::regclass
    `);
    console.log('=== Constraints on request_documents ===');
    res.rows.forEach(r => {
      console.log(`  ${r.conname}: ${r.pg_get_constraintdef}`);
    });
    process.exit(0);
  } catch(e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
