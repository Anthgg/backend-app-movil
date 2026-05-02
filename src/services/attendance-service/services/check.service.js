const { query } = require('../../../config/database');

async function findActiveCheckIn(workerId) {
    const today = new Date().toISOString().split('T')[0];
    const result = await query(
        'SELECT * FROM attendance_records WHERE worker_id = $1 AND date = $2 AND check_out_time IS NULL AND deleted_at IS NULL',
        [workerId, today]
    );
    return result.rows[0];
}

async function createCheckIn(data) {
    const { workerId, tenantId, latitude, longitude, gps_accuracy, device_identifier, photo_url, notes } = data;
    const today = new Date().toISOString().split('T')[0];

    // Determinar si la marcación es tardía
    // (Lógica de turnos omitida por simplicidad, se asume un horario fijo para el ejemplo)
    const isLate = new Date().getHours() > 9; // Ejemplo: tarde si marca después de las 9 AM
    const status = isLate ? 'late' : 'present';

    const sql = `
      INSERT INTO attendance_records 
        (worker_id, company_id, date, check_in_time, status, 
         check_in_latitude, check_in_longitude, check_in_gps_accuracy, 
         check_in_device_id, check_in_photo_url, check_in_notes)
      VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;
    const params = [
        workerId, tenantId, today, status,
        latitude, longitude, gps_accuracy,
        device_identifier, photo_url, notes
    ];
    const result = await query(sql, params);
    return result.rows[0];
}

async function updateCheckOut(recordId, data) {
    const { latitude, longitude, gps_accuracy, photo_url, notes } = data;
    const sql = `
      UPDATE attendance_records 
      SET 
        check_out_time = NOW(),
        check_out_latitude = $1,
        check_out_longitude = $2,
        check_out_gps_accuracy = $3,
        check_out_photo_url = $4,
        check_out_notes = $5
      WHERE id = $6
      RETURNING *
    `;
    const params = [latitude, longitude, gps_accuracy, photo_url, notes, recordId];
    const result = await query(sql, params);
    return result.rows[0];
}

module.exports = { findActiveCheckIn, createCheckIn, updateCheckOut };
