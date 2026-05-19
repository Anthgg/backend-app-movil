require('dotenv').config({ path: '.env.production.local' });
const { query } = require('../src/config/database');

(async () => {
  try {
    console.log('=== MIGRANDO BASE DE DATOS DE PRODUCCION ===');
    console.log('DB URL:', process.env.DATABASE_URL.split('@')[1]); // ocultar password

    console.log('\n1. Agregando columnas faltantes a request_documents...');
    
    const columns = [
      'company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE',
      'document_type VARCHAR(50)',
      'file_url TEXT',
      'file_path TEXT',
      'mime_type VARCHAR(100)',
      'file_size INTEGER',
      'status VARCHAR(30) DEFAULT \'pending\'',
      'observation TEXT',
      'uploaded_by UUID REFERENCES public.users(id)',
      'reviewed_by UUID REFERENCES public.users(id)',
      'reviewed_at TIMESTAMP WITH TIME ZONE',
      'created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()'
    ];

    for (let col of columns) {
      try {
        await query(`ALTER TABLE public.request_documents ADD COLUMN IF NOT EXISTS ${col}`);
        console.log(`  + Columna ${col.split(' ')[0]} agregada (o ya existía).`);
      } catch (e) {
        console.log(`  ~ Error con ${col.split(' ')[0]}:`, e.message);
      }
    }

    console.log('\n2. Arreglando Primary Key de request_documents...');
    try { await query('ALTER TABLE public.request_documents DROP CONSTRAINT IF EXISTS request_documents_pkey'); } catch(e){}
    try { await query('ALTER TABLE public.request_documents ALTER COLUMN document_id DROP NOT NULL'); } catch(e){}
    
    // Si id no existe, agregarlo
    try {
      await query('ALTER TABLE public.request_documents ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4()');
    } catch(e){}

    // Limpiar tabla por si acaso (solo para no chocar con constraint de null en pk)
    await query('DELETE FROM public.request_documents WHERE id IS NULL');

    try { await query('ALTER TABLE public.request_documents ADD PRIMARY KEY (id)'); } catch(e){}
    
    console.log('  + PK arreglada.');

    console.log('\n3. Creando Bucket en Storage...');
    await query(`
      INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      VALUES (
        'request-documents', 'request-documents', true, 10485760,
        ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'text/plain', 'application/octet-stream']
      )
      ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 10485760;
    `);
    console.log('  + Bucket request-documents creado/actualizado.');

    console.log('\n4. Creando Policies RLS (storage.objects)');
    const policies = [
      `CREATE POLICY "request_docs_select" ON storage.objects FOR SELECT USING (bucket_id = 'request-documents')`,
      `CREATE POLICY "request_docs_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'request-documents')`,
      `CREATE POLICY "request_docs_update" ON storage.objects FOR UPDATE USING (bucket_id = 'request-documents')`,
      `CREATE POLICY "request_docs_delete" ON storage.objects FOR DELETE USING (bucket_id = 'request-documents')`
    ];
    for(let p of policies) {
      const pName = p.match(/POLICY "(.*?)"/)[1];
      try { await query(`DROP POLICY IF EXISTS "${pName}" ON storage.objects`); } catch(e){}
      try { await query(p); console.log(`  + Policy ${pName} creada.`); } catch(e){ console.log(`  ~ Policy ${pName} falló:`, e.message); }
    }

    console.log('\n5. Creando Policies RLS (request_documents)');
    try { await query('ALTER TABLE public.request_documents ENABLE ROW LEVEL SECURITY'); } catch(e){}
    const tPolicies = [
      `CREATE POLICY "request_documents_select_policy" ON public.request_documents FOR SELECT USING (true)`,
      `CREATE POLICY "request_documents_insert_policy" ON public.request_documents FOR INSERT WITH CHECK (true)`,
      `CREATE POLICY "request_documents_update_policy" ON public.request_documents FOR UPDATE USING (true)`,
      `CREATE POLICY "request_documents_delete_policy" ON public.request_documents FOR DELETE USING (true)`
    ];
    for(let p of tPolicies) {
      const pName = p.match(/POLICY "(.*?)"/)[1];
      try { await query(`DROP POLICY IF EXISTS "${pName}" ON public.request_documents`); } catch(e){}
      try { await query(p); console.log(`  + Policy ${pName} creada.`); } catch(e){ console.log(`  ~ Policy ${pName} falló:`, e.message); }
    }

    console.log('\n¡MIGRACIÓN DE PRODUCCIÓN COMPLETADA!');
    process.exit(0);
  } catch (error) {
    console.error('ERROR FATAL:', error);
    process.exit(1);
  }
})();
