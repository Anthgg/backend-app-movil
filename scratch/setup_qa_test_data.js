const { query } = require('../src/config/database');

async function setupTestData() {
  try {
    const companyId = 'c487e654-6827-4dc8-8690-baed056bcd5e';
    const adminWorkerId = 'b4c7805d-d248-47e0-a2cc-ba3bf6eef02c';

    console.log('--- Limpiando datos previos ---');
    await query(`DELETE FROM attendance_records WHERE worker_id = $1 OR worker_id IN (SELECT id FROM workers WHERE company_id = $2)`, [adminWorkerId, companyId]);

    console.log('--- Configurando Turnos ---');
    
    // 1. Crear Turno 1 (07:00 - 16:00)
    const shift1Res = await query(`
      INSERT INTO shifts (company_id, name, start_time, end_time, tolerance_minutes, allows_overtime, is_active)
      VALUES ($1, 'Turno 1 (Mañana)', '07:00:00', '16:00:00', 5, true, true)
      RETURNING id
    `, [companyId]);
    const shift1Id = shift1Res.rows[0].id;
    console.log(`Turno 1 creado con ID: ${shift1Id}`);

    // 2. Asignar Turno 1 al Admin QA
    await query(`UPDATE workers SET shift_id = $1, company_id = $2 WHERE id = $3`, [shift1Id, companyId, adminWorkerId]);
    console.log('Turno 1 asignado al Admin QA.');

    // 3. Obtener otros trabajadores de la misma empresa
    const otherWorkers = await query(`SELECT id FROM workers WHERE company_id = $1 AND id != $2 LIMIT 3`, [companyId, adminWorkerId]);
    
    for (const worker of otherWorkers.rows) {
      await query(`UPDATE workers SET shift_id = $1 WHERE id = $2`, [shift1Id, worker.id]);
      console.log(`Turno 1 asignado al trabajador: ${worker.id}`);
    }

    console.log('\n--- Generando Marcaciones de Prueba ---');

    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    // Marcaciones para el Admin QA
    // Hoy: Marcó a las 07:04 (Dentro de tolerancia)
    await query(`
      INSERT INTO attendance_records (
        worker_id, company_id, date, check_in_time, status, attendance_status, 
        shift_id, scheduled_check_in, scheduled_check_out, tolerance_minutes, late_minutes
      ) VALUES ($1, $2, $3::DATE, ($3 || ' 07:04:00')::TIMESTAMP, 'present', 'tolerance', $4, '07:00:00', '16:00:00', 5, 0)
    `, [adminWorkerId, companyId, today, shift1Id]);

    // Ayer: Marcó a las 07:15 (Tardanza de 15 min) y salió a las 16:30 (30 min extra)
    await query(`
      INSERT INTO attendance_records (
        worker_id, company_id, date, check_in_time, check_out_time, status, attendance_status, final_status,
        shift_id, scheduled_check_in, scheduled_check_out, tolerance_minutes, late_minutes, worked_minutes, overtime_minutes
      ) VALUES ($1, $2, $3::DATE, ($3 || ' 07:15:00')::TIMESTAMP, ($3 || ' 16:30:00')::TIMESTAMP, 'late', 'late', 'completed_overtime', $4, '07:00:00', '16:00:00', 5, 15, 555, 30)
    `, [adminWorkerId, companyId, yesterday, shift1Id]);

    // Marcaciones para otros trabajadores
    if (otherWorkers.rows.length > 0) {
      const worker2 = otherWorkers.rows[0].id;
      // Hoy: Marcó a tiempo 06:55
      await query(`
        INSERT INTO attendance_records (
          worker_id, company_id, date, check_in_time, status, attendance_status, 
          shift_id, scheduled_check_in, scheduled_check_out, tolerance_minutes, late_minutes
        ) VALUES ($1, $2, $3::DATE, ($3 || ' 06:55:00')::TIMESTAMP, 'present', 'on_time', $4, '07:00:00', '16:00:00', 5, 0)
      `, [worker2, companyId, today, shift1Id]);
      
      // Ayer: Falta (absent)
      await query(`
        INSERT INTO attendance_records (
          worker_id, company_id, date, status, attendance_status, final_status,
          shift_id, scheduled_check_in, scheduled_check_out
        ) VALUES ($1, $2, $3::DATE, 'absent', 'absent', 'absent', $4, '07:00:00', '16:00:00')
      `, [worker2, companyId, yesterday, shift1Id]);
    }

    console.log('\n¡Datos de prueba generados exitosamente!');
    process.exit(0);
  } catch (err) {
    console.error('Error configurando datos:', err);
    process.exit(1);
  }
}

setupTestData();
