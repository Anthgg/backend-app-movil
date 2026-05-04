#!/usr/bin/env node
require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  try {
    console.log('📡 Conectando a Supabase...');
    await client.connect();
    console.log('✅ Conectado\n');
    
    // Leer el script SQL
    const sqlScript = fs.readFileSync('scripts/seed-qa-admin-data.sql', 'utf8');
    
    console.log('🌱 Insertando datos falsos para admin.qa@demo.com...\n');
    const startTime = Date.now();
    
    // Ejecutar el script
    await client.query(sqlScript);
    
    const duration = Date.now() - startTime;
    console.log(`\n✅ Datos insertados en ${duration}ms\n`);
    
    // ================================================
    // VERIFICAR DATOS INSERTADOS
    // ================================================
    
    console.log('📊 ========== VERIFICACIÓN DE DATOS ==========\n');
    
    // 1. Verificar Worker
    const workerRes = await client.query(`
      SELECT 
        w.id,
        w.document_number,
        w.phone_number,
        w.address,
        jp.title as position,
        d.name as department,
        w.hire_date,
        w.status
      FROM public.workers w
      LEFT JOIN public.job_positions jp ON w.job_position_id = jp.id
      LEFT JOIN public.departments d ON jp.department_id = d.id
      WHERE w.user_id = (SELECT id FROM public.users WHERE email = 'admin.qa@demo.com')
    `);
    
    if (workerRes.rows.length > 0) {
      const worker = workerRes.rows[0];
      console.log('👤 WORKER CREADO:');
      console.log(`   ID: ${worker.id}`);
      console.log(`   Documento: ${worker.document_number}`);
      console.log(`   Teléfono: ${worker.phone_number}`);
      console.log(`   Dirección: ${worker.address}`);
      console.log(`   Posición: ${worker.position} (${worker.department})`);
      console.log(`   Salario Base: $5000`);
      console.log(`   Fecha Contratación: ${worker.hire_date}`);
      console.log(`   Estado: ${worker.status}\n`);
    }
    
    // 2. Verificar Departamentos
    const depRes = await client.query(`
      SELECT COUNT(*) as total FROM public.departments
    `);
    console.log(`🏢 DEPARTAMENTOS: ${depRes.rows[0].total}\n`);
    
    // 3. Verificar Posiciones
    const posRes = await client.query(`
      SELECT COUNT(*) as total FROM public.job_positions
    `);
    console.log(`💼 POSICIONES DE TRABAJO: ${posRes.rows[0].total}\n`);
    
    // 4. Verificar Proyectos
    const projRes = await client.query(`
      SELECT COUNT(*) as total FROM public.projects WHERE is_active = TRUE
    `);
    console.log(`📍 PROYECTOS ACTIVOS: ${projRes.rows[0].total}\n`);
    
    // 5. Verificar Asignaciones
    const assignRes = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(DISTINCT project_id) as projects
      FROM public.project_assignments
      WHERE worker_id = (
        SELECT id FROM public.workers 
        WHERE user_id = (SELECT id FROM public.users WHERE email = 'admin.qa@demo.com')
      )
    `);
    
    if (assignRes.rows.length > 0 && assignRes.rows[0].total > 0) {
      console.log(`📌 ASIGNACIONES DE PROYECTOS: ${assignRes.rows[0].projects} proyectos\n`);
    }
    
    // 6. Verificar Registros de Asistencia
    const attRes = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'PRESENT' THEN 1 END) as present,
        COUNT(CASE WHEN status = 'LATE' THEN 1 END) as late,
        COUNT(CASE WHEN status = 'ABSENT' THEN 1 END) as absent,
        MIN(date) as first_date,
        MAX(date) as last_date
      FROM public.attendance_records
      WHERE worker_id = (
        SELECT id FROM public.workers 
        WHERE user_id = (SELECT id FROM public.users WHERE email = 'admin.qa@demo.com')
      )
    `);
    
    if (attRes.rows[0].total > 0) {
      const att = attRes.rows[0];
      console.log(`📅 REGISTROS DE ASISTENCIA:`);
      console.log(`   Total: ${att.total}`);
      console.log(`   Presentes: ${att.present}`);
      console.log(`   Tardanzas: ${att.late}`);
      console.log(`   Ausentes: ${att.absent}`);
      console.log(`   Período: ${att.first_date} a ${att.last_date}\n`);
    }
    
    // 7. Verificar Fotos
    const photoRes = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN photo_type = 'CHECK_IN' THEN 1 END) as check_in,
        COUNT(CASE WHEN photo_type = 'CHECK_OUT' THEN 1 END) as check_out
      FROM public.attendance_photos ap
      WHERE ap.attendance_record_id IN (
        SELECT ar.id FROM public.attendance_records ar
        WHERE ar.worker_id = (
          SELECT id FROM public.workers 
          WHERE user_id = (SELECT id FROM public.users WHERE email = 'admin.qa@demo.com')
        )
      )
    `);
    
    if (photoRes.rows[0].total > 0) {
      const photos = photoRes.rows[0];
      console.log(`📸 FOTOS DE ASISTENCIA:`);
      console.log(`   Total: ${photos.total}`);
      console.log(`   Check-In: ${photos.check_in}`);
      console.log(`   Check-Out: ${photos.check_out}\n`);
    }
    
    // 8. Resumen de horarios
    const schedRes = await client.query(`
      SELECT name, start_time, end_time, tolerance_minutes 
      FROM public.work_schedules 
      ORDER BY start_time
    `);
    
    console.log(`⏰ HORARIOS DE TRABAJO DISPONIBLES:`);
    schedRes.rows.forEach(s => {
      console.log(`   ${s.name}: ${s.start_time} - ${s.end_time} (tolerancia: ${s.tolerance_minutes} min)`);
    });
    
    console.log('\n✅ ========== SEED DATA COMPLETADO ==========\n');
    console.log('📱 La app móvil ahora puede usar el usuario admin.qa@demo.com');
    console.log('   con datos completos de horarios, proyectos y asistencia.\n');
    
  } catch (error) {
    console.error('\n❌ ERROR:');
    console.error('Código:', error.code);
    console.error('Mensaje:', error.message);
    if (error.detail) console.error('Detalle:', error.detail);
    process.exit(1);
  } finally {
    await client.end();
  }
})();
