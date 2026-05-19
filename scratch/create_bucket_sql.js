const { query } = require('../src/config/database');

(async () => {
  try {
    console.log('=== Creando bucket request-documents via SQL ===\n');

    // Insertar el bucket directamente en la tabla de storage
    const res = await query(`
      INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      VALUES (
        'request-documents',
        'request-documents',
        true,
        10485760,
        ARRAY[
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
      )
      ON CONFLICT (id) DO UPDATE SET
        public = true,
        file_size_limit = 10485760
      RETURNING id, name, public;
    `);

    console.log('Bucket creado:', res.rows[0]);

    // Verificar
    const check = await query(`SELECT id, name, public, file_size_limit FROM storage.buckets WHERE id = 'request-documents'`);
    console.log('\nVerificacion:', check.rows[0]);

    console.log('\nBucket listo!');
    process.exit(0);
  } catch(e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
