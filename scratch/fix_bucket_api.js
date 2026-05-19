require('dotenv').config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');

(async () => {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!serviceRoleKey) {
      console.error('❌ No se encontró SUPABASE_SERVICE_ROLE_KEY en .env.production.local');
      process.exit(1);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    console.log('🔗 Conectado a Supabase con Service Role...');

    // 1. Borrar el bucket fantasma (incluso si la API no lo ve al 100%, force = true)
    console.log('🗑️ Intentando eliminar bucket fantasma...');
    const { error: deleteError } = await supabaseAdmin.storage.deleteBucket('request-documents');
    if (deleteError) {
      console.log('  ⚠️ (Ignorar si dice Not Found):', deleteError.message);
    } else {
      console.log('  ✅ Bucket eliminado.');
    }

    // 2. Crear el bucket real a través de la API
    console.log('🏗️ Creando bucket request-documents real en la nube...');
    const { data, error: createError } = await supabaseAdmin.storage.createBucket('request-documents', {
      public: true,
      allowedMimeTypes: [
        'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 
        'application/pdf', 'application/msword', 
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 
        'application/vnd.ms-excel', 
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 
        'application/vnd.ms-powerpoint', 
        'application/vnd.openxmlformats-officedocument.presentationml.presentation', 
        'text/plain', 'application/octet-stream'
      ],
      fileSizeLimit: 10485760 // 10MB
    });

    if (createError) {
      console.error('❌ Error creando bucket:', createError.message);
    } else {
      console.log('✅ ¡Bucket request-documents creado EXITOSAMENTE con disco físico!');
    }

  } catch(e) {
    console.error('Crash:', e);
  }
})();
