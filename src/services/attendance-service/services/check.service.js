const { query } = require('../../../config/database');
const moment = require('moment-timezone');

// Usar la zona horaria de Lima (Perú) por defecto si no se especifica
const TIMEZONE = process.env.TZ || 'America/Lima';

async function findActiveCheckIn(workerId) {
    const today = moment().tz(TIMEZONE).format('YYYY-MM-DD');
    const result = await query(
        'SELECT * FROM attendance_records WHERE worker_id = $1 AND date = $2 AND check_out_time IS NULL',
        [workerId, today]
    );
    return result.rows[0];
}

async function createCheckIn(data) {
    const { workerId, tenantId, latitude, longitude, gps_accuracy, device_identifier, photo_url, notes } = data;
    const now = moment().tz(TIMEZONE);
    const today = now.format('YYYY-MM-DD');
    const currentTime = now.format('HH:mm:ss');

    // 1. Obtener turno del trabajador
    const shiftRes = await query(
        `SELECT s.* FROM shifts s
         JOIN workers w ON w.shift_id = s.id
         WHERE w.id = $1 AND w.company_id = $2`,
        [workerId, tenantId]
    );

    if (shiftRes.rows.length === 0) {
        const err = new Error('No tienes un turno asignado. Contacta a RRHH.');
        err.statusCode = 400;
        throw err;
    }

    const shift = shiftRes.rows[0];
    const startTime = shift.start_time;
    const tolerance = shift.tolerance_minutes || 0;

    // 2. Calcular estado de entrada y minutos de tardanza
    let attendanceStatus = 'on_time';
    let lateMinutes = 0;

    const scheduledStart = moment(`${today} ${startTime}`, 'YYYY-MM-DD HH:mm:ss');
    const toleranceLimit = moment(scheduledStart).add(tolerance, 'minutes');

    if (now.isAfter(toleranceLimit)) {
        attendanceStatus = 'late';
        lateMinutes = Math.floor(moment.duration(now.diff(scheduledStart)).asMinutes());
    } else if (now.isAfter(scheduledStart)) {
        attendanceStatus = 'tolerance';
    }

    const sql = `
      INSERT INTO attendance_records 
        (worker_id, company_id, date, check_in_time, status, 
         check_in_latitude, check_in_longitude, check_in_gps_accuracy, 
         check_in_device_id, check_in_photo_url, check_in_notes,
         shift_id, scheduled_check_in, scheduled_check_out, tolerance_minutes,
         late_minutes, attendance_status)
      VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *
    `;
    const params = [
        workerId, tenantId, today, attendanceStatus,
        latitude, longitude, gps_accuracy,
        device_identifier, photo_url, notes,
        shift.id, shift.start_time, shift.end_time, tolerance,
        lateMinutes, attendanceStatus
    ];
    const result = await query(sql, params);
    return result.rows[0];
}

async function updateCheckOut(recordId, data) {
    const { latitude, longitude, gps_accuracy, photo_url, notes } = data;
    const now = moment().tz(TIMEZONE);
    
    // 1. Obtener registro de entrada y turno
    const recordRes = await query(
        `SELECT ar.*, s.allows_overtime FROM attendance_records ar
         LEFT JOIN shifts s ON ar.shift_id = s.id
         WHERE ar.id = $1`,
        [recordId]
    );
    const record = recordRes.rows[0];
    const checkInTime = moment(record.check_in_time).tz(TIMEZONE);
    
    // Manejo de salida programada (puede ser al día siguiente si es turno nocturno)
    let scheduledCheckOut = moment(`${record.date} ${record.scheduled_check_out}`, 'YYYY-MM-DD HH:mm:ss');
    if (scheduledCheckOut.isBefore(checkInTime)) {
        scheduledCheckOut.add(1, 'day');
    }

    // 2. Calcular métricas
    const workedMinutes = Math.floor(moment.duration(now.diff(checkInTime)).asMinutes());
    let overtimeMinutes = 0;
    let earlyLeaveMinutes = 0;
    let finalStatus = 'completed';

    if (now.isAfter(scheduledCheckOut)) {
        if (record.allows_overtime) {
            overtimeMinutes = Math.floor(moment.duration(now.diff(scheduledCheckOut)).asMinutes());
            finalStatus = overtimeMinutes > 0 ? 'completed_overtime' : 'completed';
        }
    } else if (now.isBefore(scheduledCheckOut)) {
        earlyLeaveMinutes = Math.floor(moment.duration(scheduledCheckOut.diff(now)).asMinutes());
        finalStatus = 'early_leave';
    }

    const sql = `
      UPDATE attendance_records 
      SET 
        check_out_time = NOW(),
        check_out_latitude = $1,
        check_out_longitude = $2,
        check_out_gps_accuracy = $3,
        check_out_photo_url = $4,
        check_out_notes = $5,
        worked_minutes = $6,
        overtime_minutes = $7,
        early_leave_minutes = $8,
        final_status = $9,
        status = $10,
        updated_at = NOW()
      WHERE id = $11
      RETURNING *
    `;
    const params = [
        latitude, longitude, gps_accuracy, photo_url, notes,
        workedMinutes, overtimeMinutes, earlyLeaveMinutes, 
        finalStatus, finalStatus, recordId
    ];
    const result = await query(sql, params);
    return result.rows[0];
}

module.exports = { findActiveCheckIn, createCheckIn, updateCheckOut };
