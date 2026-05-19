require('dotenv').config({ path: '.env' });
const { Pool } = require('pg');

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('Migrando request_documents en la base de datos real...');
    const client = await pool.connect();
    
    const sql = `
      -- 1. Borrar la tabla vieja si existe para alinear PK
      DROP TABLE IF EXISTS public.request_documents CASCADE;

      -- 2. Crear la tabla con el esquema correcto
      CREATE TABLE public.request_documents (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
          request_id UUID REFERENCES public.employee_requests(id) ON DELETE CASCADE,
          document_type VARCHAR(50),
          file_url TEXT NOT NULL,
          file_path TEXT,
          mime_type VARCHAR(100),
          file_size INTEGER,
          status VARCHAR(30) DEFAULT 'pending',
          observation TEXT,
          uploaded_by UUID REFERENCES public.users(id),
          reviewed_by UUID REFERENCES public.users(id),
          reviewed_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- 3. Crear índices
      CREATE INDEX IF NOT EXISTS idx_request_documents_request_id ON public.request_documents(request_id);
      CREATE INDEX IF NOT EXISTS idx_request_documents_company_id ON public.request_documents(company_id);

      -- 4. Habilitar RLS
      ALTER TABLE public.request_documents ENABLE ROW LEVEL SECURITY;

      -- 5. Crear políticas de RLS
      DROP POLICY IF EXISTS "request_documents_select_policy" ON public.request_documents;
      CREATE POLICY "request_documents_select_policy" ON public.request_documents FOR SELECT USING (true);

      DROP POLICY IF EXISTS "request_documents_insert_policy" ON public.request_documents;
      CREATE POLICY "request_documents_insert_policy" ON public.request_documents FOR INSERT WITH CHECK (true);

      DROP POLICY IF EXISTS "request_documents_delete_policy" ON public.request_documents;
      CREATE POLICY "request_documents_delete_policy" ON public.request_documents FOR DELETE USING (true);
    `;
    
    await client.query(sql);
    console.log('✅ ¡Tabla request_documents y políticas RLS creadas exitosamente!');
    
    client.release();
    process.exit(0);
  } catch(e) {
    console.error('❌ Error migrando DB:', e.message);
    process.exit(1);
  }
})();
