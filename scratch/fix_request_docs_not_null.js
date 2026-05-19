const { query } = require('../src/config/database');

(async () => {
  try {
    console.log('=== Arreglando tabla request_documents ===\n');

    // 1. Quitar la llave primaria compuesta anterior
    console.log('1. Eliminando request_documents_pkey...');
    try {
      await query('ALTER TABLE public.request_documents DROP CONSTRAINT request_documents_pkey');
      console.log('   ✅ PK compuesta eliminada.');
    } catch(e) { console.log('   ~ PK:', e.message); }

    // 2. Hacer document_id opcional
    console.log('\n2. Haciendo document_id opcional...');
    await query('ALTER TABLE public.request_documents ALTER COLUMN document_id DROP NOT NULL');
    console.log('   ✅ document_id ahora es opcional.');

    // 3. Limpiar tabla (es solo de QA, si hay algo) para poder poner id como PK sin duplicados/nulos
    console.log('\n3. Limpiando tabla (para evitar issues con nulos/duplicados en nueva PK)...');
    await query('DELETE FROM public.request_documents WHERE id IS NULL');
    
    // 4. Asegurar id
    console.log('\n4. Configurando columna id como nueva PRIMARY KEY...');
    await query('ALTER TABLE public.request_documents ALTER COLUMN id SET DEFAULT uuid_generate_v4()');
    
    try {
      await query('ALTER TABLE public.request_documents ADD PRIMARY KEY (id)');
      console.log('   ✅ id ahora es PRIMARY KEY.');
    } catch(e) {
      if (e.message.includes('already a primary key')) {
        console.log('   ~ id ya es PRIMARY KEY.');
      } else {
        console.log('   ! Error al setear id como PK:', e.message);
      }
    }

    // 5. Verificar esquema final
    const res = await query(`
      SELECT column_name, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'request_documents' 
      AND column_name IN ('document_id', 'id')
    `);
    console.log('\nEstado actual:');
    res.rows.forEach(r => console.log(`   ${r.column_name}: nullable=${r.is_nullable}`));

    const resPK = await query(`
      SELECT conname, pg_get_constraintdef(c.oid)
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE conrelid = 'public.request_documents'::regclass AND contype = 'p'
    `);
    console.log('\nLlave primaria actual:');
    resPK.rows.forEach(r => console.log(`   ${r.pg_get_constraintdef}`));

    console.log('\nArreglo completado!');
    process.exit(0);
  } catch(error) {
    console.error('Error fatal:', error.message);
    process.exit(1);
  }
})();
