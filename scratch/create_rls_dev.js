require('dotenv').config({ path: '.env' });
const { Pool } = require('pg');

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('Creando policies en uuerlnamjnogynldnjdt...');
    const client = await pool.connect();
    
    // RLS Policies for storage.objects
    const policies = [
      `CREATE POLICY "request_docs_select" ON storage.objects FOR SELECT USING (bucket_id = 'request-documents')`,
      `CREATE POLICY "request_docs_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'request-documents')`,
      `CREATE POLICY "request_docs_update" ON storage.objects FOR UPDATE USING (bucket_id = 'request-documents')`,
      `CREATE POLICY "request_docs_delete" ON storage.objects FOR DELETE USING (bucket_id = 'request-documents')`
    ];
    
    for(let p of policies) {
      const pName = p.match(/POLICY "(.*?)"/)[1];
      try { await client.query(`DROP POLICY IF EXISTS "${pName}" ON storage.objects`); } catch(e){}
      try { 
        await client.query(p); 
        console.log(`  + Policy ${pName} creada.`); 
      } catch(e) { 
        console.log(`  ~ Policy ${pName} falló:`, e.message); 
      }
    }
    
    client.release();
    console.log('✅ Listo!');
    process.exit(0);
  } catch(e) {
    console.error('Crash:', e);
    process.exit(1);
  }
})();
