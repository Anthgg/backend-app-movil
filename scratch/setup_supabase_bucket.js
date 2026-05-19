/**
 * Script para crear el bucket 'request-documents' en Supabase Storage
 * y configurar las políticas RLS necesarias.
 * 
 * Usa el cliente de Supabase ya configurado en el proyecto.
 * Si el SUPABASE_PUBLISHABLE_KEY tiene permisos de service_role, 
 * podrá crear el bucket. Si no, se debe crear manualmente desde el dashboard.
 */

const { getSupabaseClient } = require('../src/config/supabase');
const { query } = require('../src/config/database');

const BUCKET_NAME = 'request-documents';

async function createBucket() {
  const supabase = getSupabaseClient();
  
  if (!supabase) {
    console.error('Supabase client no configurado. Verifica SUPABASE_URL y SUPABASE_PUBLISHABLE_KEY.');
    process.exit(1);
  }

  console.log('=== Configurando Supabase Storage para request-documents ===\n');

  // 1. Verificar si el bucket ya existe
  console.log('1. Verificando buckets existentes...');
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  
  if (listError) {
    console.error('   Error listando buckets:', listError.message);
    console.log('   Intentando crear el bucket de todas formas...');
  } else {
    const existing = buckets.find(b => b.name === BUCKET_NAME);
    if (existing) {
      console.log(`   Bucket '${BUCKET_NAME}' ya existe. ID: ${existing.id}`);
      console.log('   Saltando creacion...');
      await setupRLS();
      process.exit(0);
    }
    console.log(`   Bucket '${BUCKET_NAME}' no encontrado. Creando...`);
  }

  // 2. Crear el bucket
  console.log('\n2. Creando bucket...');
  const { data, error } = await supabase.storage.createBucket(BUCKET_NAME, {
    public: true,
    fileSizeLimit: 10 * 1024 * 1024,  // 10MB
    allowedMimeTypes: [
      'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/bmp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      'application/octet-stream'
    ]
  });

  if (error) {
    if (error.message && error.message.includes('already exists')) {
      console.log(`   Bucket '${BUCKET_NAME}' ya existe (detectado por error).`);
    } else {
      console.error('   Error creando bucket:', error.message);
      console.log('\n   Si el error es de permisos, crea el bucket manualmente:');
      console.log('   Supabase Dashboard > Storage > New Bucket');
      console.log(`   Nombre: ${BUCKET_NAME}`);
      console.log('   Public: Si');
      console.log('   File size limit: 10 MB');
    }
  } else {
    console.log(`   Bucket '${BUCKET_NAME}' creado exitosamente!`);
  }

  // 3. Configurar RLS
  await setupRLS();

  console.log('\nConfiguracion completada!');
  process.exit(0);
}

async function setupRLS() {
  console.log('\n3. Configurando RLS policies en storage.objects...');

  const policies = [
    {
      name: `request_docs_select`,
      sql: `
        CREATE POLICY "request_docs_select" ON storage.objects
        FOR SELECT USING (bucket_id = '${BUCKET_NAME}');
      `
    },
    {
      name: `request_docs_insert`,
      sql: `
        CREATE POLICY "request_docs_insert" ON storage.objects
        FOR INSERT WITH CHECK (bucket_id = '${BUCKET_NAME}');
      `
    },
    {
      name: `request_docs_update`,
      sql: `
        CREATE POLICY "request_docs_update" ON storage.objects
        FOR UPDATE USING (bucket_id = '${BUCKET_NAME}');
      `
    },
    {
      name: `request_docs_delete`,
      sql: `
        CREATE POLICY "request_docs_delete" ON storage.objects
        FOR DELETE USING (bucket_id = '${BUCKET_NAME}');
      `
    }
  ];

  for (const policy of policies) {
    try {
      // Primero intentar eliminar si existe
      await query(`DROP POLICY IF EXISTS "${policy.name}" ON storage.objects`);
      await query(policy.sql);
      console.log(`   + Policy '${policy.name}' creada`);
    } catch (e) {
      if (e.message.includes('already exists')) {
        console.log(`   ~ Policy '${policy.name}' ya existe`);
      } else {
        console.log(`   ! Policy '${policy.name}': ${e.message}`);
      }
    }
  }

  // 4. Tambien asegurar RLS en request_documents table
  console.log('\n4. Configurando RLS en tabla request_documents...');
  
  const tablePolicies = [
    {
      name: 'request_documents_select_policy',
      sql: `CREATE POLICY "request_documents_select_policy" ON public.request_documents FOR SELECT USING (true);`
    },
    {
      name: 'request_documents_insert_policy',
      sql: `CREATE POLICY "request_documents_insert_policy" ON public.request_documents FOR INSERT WITH CHECK (true);`
    },
    {
      name: 'request_documents_delete_policy',
      sql: `CREATE POLICY "request_documents_delete_policy" ON public.request_documents FOR DELETE USING (true);`
    },
    {
      name: 'request_documents_update_policy',
      sql: `CREATE POLICY "request_documents_update_policy" ON public.request_documents FOR UPDATE USING (true);`
    }
  ];

  try {
    await query(`ALTER TABLE public.request_documents ENABLE ROW LEVEL SECURITY`);
    console.log('   RLS habilitado en request_documents');
  } catch(e) {
    console.log(`   ~ RLS: ${e.message}`);
  }

  for (const policy of tablePolicies) {
    try {
      await query(`DROP POLICY IF EXISTS "${policy.name}" ON public.request_documents`);
      await query(policy.sql);
      console.log(`   + Policy '${policy.name}' creada`);
    } catch (e) {
      if (e.message.includes('already exists')) {
        console.log(`   ~ Policy '${policy.name}' ya existe`);
      } else {
        console.log(`   ! Policy '${policy.name}': ${e.message}`);
      }
    }
  }
}

createBucket().catch(e => {
  console.error('Error fatal:', e.message);
  process.exit(1);
});
