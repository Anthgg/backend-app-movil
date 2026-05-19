const { query } = require('../src/config/database');
(async () => {
  try {
    console.log('=== Actualizando tabla request_documents ===\n');

    // Agregar company_id
    try {
      await query(`ALTER TABLE public.request_documents ADD COLUMN company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE`);
      console.log('  + company_id agregado');
    } catch(e) { console.log('  ~ company_id:', e.message.includes('already exists') ? 'ya existe' : e.message); }

    // Agregar document_type
    try {
      await query(`ALTER TABLE public.request_documents ADD COLUMN document_type VARCHAR(50)`);
      console.log('  + document_type agregado');
    } catch(e) { console.log('  ~ document_type:', e.message.includes('already exists') ? 'ya existe' : e.message); }

    // Agregar file_url
    try {
      await query(`ALTER TABLE public.request_documents ADD COLUMN file_url TEXT`);
      console.log('  + file_url agregado');
    } catch(e) { console.log('  ~ file_url:', e.message.includes('already exists') ? 'ya existe' : e.message); }

    // Agregar file_path
    try {
      await query(`ALTER TABLE public.request_documents ADD COLUMN file_path TEXT`);
      console.log('  + file_path agregado');
    } catch(e) { console.log('  ~ file_path:', e.message.includes('already exists') ? 'ya existe' : e.message); }

    // Agregar mime_type
    try {
      await query(`ALTER TABLE public.request_documents ADD COLUMN mime_type VARCHAR(100)`);
      console.log('  + mime_type agregado');
    } catch(e) { console.log('  ~ mime_type:', e.message.includes('already exists') ? 'ya existe' : e.message); }

    // Agregar file_size
    try {
      await query(`ALTER TABLE public.request_documents ADD COLUMN file_size INTEGER`);
      console.log('  + file_size agregado');
    } catch(e) { console.log('  ~ file_size:', e.message.includes('already exists') ? 'ya existe' : e.message); }

    // Agregar status
    try {
      await query(`ALTER TABLE public.request_documents ADD COLUMN status VARCHAR(30) DEFAULT 'pending'`);
      console.log('  + status agregado');
    } catch(e) { console.log('  ~ status:', e.message.includes('already exists') ? 'ya existe' : e.message); }

    // Agregar observation
    try {
      await query(`ALTER TABLE public.request_documents ADD COLUMN observation TEXT`);
      console.log('  + observation agregado');
    } catch(e) { console.log('  ~ observation:', e.message.includes('already exists') ? 'ya existe' : e.message); }

    // Agregar uploaded_by
    try {
      await query(`ALTER TABLE public.request_documents ADD COLUMN uploaded_by UUID REFERENCES public.users(id)`);
      console.log('  + uploaded_by agregado');
    } catch(e) { console.log('  ~ uploaded_by:', e.message.includes('already exists') ? 'ya existe' : e.message); }

    // Agregar reviewed_by
    try {
      await query(`ALTER TABLE public.request_documents ADD COLUMN reviewed_by UUID REFERENCES public.users(id)`);
      console.log('  + reviewed_by agregado');
    } catch(e) { console.log('  ~ reviewed_by:', e.message.includes('already exists') ? 'ya existe' : e.message); }

    // Agregar reviewed_at
    try {
      await query(`ALTER TABLE public.request_documents ADD COLUMN reviewed_at TIMESTAMP WITH TIME ZONE`);
      console.log('  + reviewed_at agregado');
    } catch(e) { console.log('  ~ reviewed_at:', e.message.includes('already exists') ? 'ya existe' : e.message); }

    // Agregar created_at
    try {
      await query(`ALTER TABLE public.request_documents ADD COLUMN created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()`);
      console.log('  + created_at agregado');
    } catch(e) { console.log('  ~ created_at:', e.message.includes('already exists') ? 'ya existe' : e.message); }

    // Agregar id como PK si no existe
    try {
      await query(`ALTER TABLE public.request_documents ADD COLUMN id UUID DEFAULT uuid_generate_v4() PRIMARY KEY`);
      console.log('  + id (PK) agregado');
    } catch(e) {
      if (e.message.includes('already exists')) {
        console.log('  ~ id: ya existe');
      } else if (e.message.includes('multiple primary keys')) {
        // Ya tiene PK compuesta, necesitamos drop y re-add
        console.log('  ~ id: tabla tiene PK compuesta, agregando sin PK...');
        try {
          await query(`ALTER TABLE public.request_documents ADD COLUMN id UUID DEFAULT uuid_generate_v4()`);
          console.log('  + id agregado (sin PK)');
        } catch(e2) { console.log('  ~ id col:', e2.message.includes('already exists') ? 'ya existe' : e2.message); }
      } else {
        console.log('  ~ id:', e.message);
      }
    }

    // Indices
    try { await query(`CREATE INDEX IF NOT EXISTS idx_request_documents_request_id ON public.request_documents(request_id)`); console.log('  + index request_id'); } catch(e) { console.log('  ~ idx:', e.message); }
    try { await query(`CREATE INDEX IF NOT EXISTS idx_request_documents_company_id ON public.request_documents(company_id)`); console.log('  + index company_id'); } catch(e) { console.log('  ~ idx:', e.message); }

    // Verificar resultado
    console.log('\n=== Esquema final ===');
    const res = await query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'request_documents'
      ORDER BY ordinal_position
    `);
    res.rows.forEach(r => {
      console.log(`  ${r.column_name.padEnd(20)} ${r.data_type.padEnd(25)} nullable:${r.is_nullable}`);
    });

    console.log('\nMigracion completada!');
    process.exit(0);
  } catch(e) { console.error('ERROR FATAL:', e.message); process.exit(1); }
})();
