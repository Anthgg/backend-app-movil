const { query } = require('../src/config/database');
(async () => {
  try {
    // Ver columnas de request_documents
    const res = await query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'request_documents'
      ORDER BY ordinal_position
    `);
    console.log('=== Columnas de request_documents ===');
    res.rows.forEach(r => {
      console.log(`  ${r.column_name.padEnd(20)} ${r.data_type.padEnd(30)} nullable:${r.is_nullable}`);
    });

    if (res.rows.length === 0) {
      console.log('  (tabla no existe!)');
    }
    
    process.exit(0);
  } catch(e) { console.error('ERROR:', e.message); process.exit(1); }
})();
