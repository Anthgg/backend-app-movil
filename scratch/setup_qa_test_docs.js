const { query } = require('../src/config/database');

async function setupTestDocuments() {
  try {
    const companyId = 'c487e654-6827-4dc8-8690-baed056bcd5e';
    const adminWorkerId = 'b4c7805d-d248-47e0-a2cc-ba3bf6eef02c';
    const lateRecordId = '0de86cb3-f34f-412d-8b36-f8e55bb68153';

    const vacationTypeId = '314f1884-19e8-4d33-b711-c28c94f17d59';
    const medicalTypeId = 'aad6e9d2-38d3-46ae-9ef4-b8cf68c86f52';

    console.log('--- Generando Evidencia de Asistencia ---');
    
    // 1. Añadir evidencia (foto/documento) a la tardanza de ayer
    await query(`
      INSERT INTO attendance_evidence (
        attendance_record_id, company_id, type, photo_url, status, hr_comment, 
        server_time, device_time, latitude, longitude, created_at
      ) VALUES ($1, $2, 'check_in', 'https://example.com/evidence/late-photo-1.jpg', 'approved', 'Justificación médica presentada por tardanza.', 
      NOW(), NOW(), -12.046374, -77.042793, NOW())
      ON CONFLICT (id) DO NOTHING
    `, [lateRecordId, companyId]);
    console.log('Evidencia de asistencia añadida.');

    console.log('\n--- Generando Solicitudes (Justificaciones) ---');

    const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

    // 2. Añadir una solicitud de vacaciones aprobada para la próxima semana
    await query(`
      INSERT INTO employee_requests (
        worker_id, company_id, request_type_id, start_date, end_date, reason, status, hr_comment, days_requested, created_at
      ) VALUES ($1, $2, $3, $4::DATE, ($4::DATE + INTERVAL '5 days')::DATE, 'Vacaciones familiares anuales', 'approved', 'Disfrute sus vacaciones.', 5, NOW())
    `, [adminWorkerId, companyId, vacationTypeId, nextWeek]);
    console.log('Solicitud de vacaciones aprobada añadida.');

    // 3. Añadir una solicitud de permiso médico pendiente para mañana
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    await query(`
      INSERT INTO employee_requests (
        worker_id, company_id, request_type_id, start_date, end_date, reason, status, hr_comment, days_requested, created_at
      ) VALUES ($1, $2, $3, $4::DATE, $4::DATE, 'Cita odontológica', 'pending', null, 1, NOW())
    `, [adminWorkerId, companyId, medicalTypeId, tomorrow]);
    console.log('Solicitud médica pendiente añadida.');

    console.log('\n¡Documentos y evidencias de prueba generados exitosamente!');
    process.exit(0);
  } catch (err) {
    console.error('Error configurando documentos:', err);
    process.exit(1);
  }
}

setupTestDocuments();
