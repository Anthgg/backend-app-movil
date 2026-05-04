require('dotenv').config();
const fs = require('fs');
const { Client } = require('pg');

// Leer la migración
const migration = fs.readFileSync('supabase/migrations/202605020021_formalize_schema_alignment.sql', 'utf8');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  try {
    console.log('📡 Conectando a Supabase...');
    await client.connect();
    console.log('✅ Conectado');
    
    console.log('\n🔄 Ejecutando migración 021...');
    const startTime = Date.now();
    await client.query(migration);
    const duration = Date.now() - startTime;
    console.log(`✅ Migración ejecutada exitosamente en ${duration}ms`);
    
    // Verificar columnas creadas
    console.log('\n📋 Verificando columnas creadas...');
    
    // 1. payroll_periods columns
    const ppCols = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'payroll_periods' 
        AND column_name IN ('year','month','company_id')
      ORDER BY column_name
    `);
    console.log('payroll_periods columns:', JSON.stringify(ppCols.rows, null, 2));
    
    // 2. attendance_records.user_id
    const arUserId = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'attendance_records' AND column_name = 'user_id'
    `);
    console.log('attendance_records.user_id:', JSON.stringify(arUserId.rows, null, 2));
    
    // 3. Verificar índice
    console.log('\n🔍 Verificando índice idx_attendance_records_user_id...');
    const indexCheck = await client.query(`
      SELECT indexname, tablename 
      FROM pg_indexes 
      WHERE indexname = 'idx_attendance_records_user_id'
    `);
    console.log('Índice:', JSON.stringify(indexCheck.rows, null, 2));
    
    // 4. Verificar trigger
    console.log('\n🔍 Verificando trigger trg_sync_attendance_user_id...');
    const triggerCheck = await client.query(`
      SELECT trigger_name, event_manipulation 
      FROM information_schema.triggers 
      WHERE trigger_name = 'trg_sync_attendance_user_id'
    `);
    console.log('Trigger:', JSON.stringify(triggerCheck.rows, null, 2));
    
    // 5. Verificar constraint
    console.log('\n🔍 Verificando constraint UNIQUE payroll_periods...');
    const constraintCheck = await client.query(`
      SELECT constraint_name, constraint_type
      FROM information_schema.table_constraints
      WHERE table_name = 'payroll_periods' 
        AND constraint_name = 'payroll_periods_company_id_year_month_key'
    `);
    console.log('Constraint:', JSON.stringify(constraintCheck.rows, null, 2));
    
    // 6. Contar registros en attendance_records con user_id populated
    console.log('\n📊 Conteo de attendance_records con user_id...');
    const arCount = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(user_id) as con_user_id,
        COUNT(*) - COUNT(user_id) as sin_user_id
      FROM attendance_records
    `);
    console.log('Estadísticas:', JSON.stringify(arCount.rows[0], null, 2));
    
    console.log('\n✅ ========== MIGRACIÓN 021 COMPLETADA EXITOSAMENTE ==========');
    
  } catch (error) {
    console.error('\n❌ ERROR durante la migración:');
    console.error('Código:', error.code);
    console.error('Mensaje:', error.message);
    console.error('Query:', error.query);
    process.exit(1);
  } finally {
    await client.end();
  }
})();
