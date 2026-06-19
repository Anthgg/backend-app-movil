const { query } = require('../../../config/database');
const { insertReturning, updateReturning } = require('../../../utils/db.util');
const {
  createAttendanceError,
  normalizeAttendanceTime
} = require('../services/attendance-context.util');



function mapAttendanceSaveError(error) {
  const message = String(error?.message || '');
  if (
    error?.errorCode === 'INVALID_ATTENDANCE_TIME' ||
    /invalid input syntax for type time/i.test(message)
  ) {
    return createAttendanceError({
      status: error?.statusCode || 400,
      code: error?.errorCode || 'INVALID_ATTENDANCE_TIME',
      message: error?.errorCode
        ? error.message
        : 'La hora de asistencia no tiene un formato valido.',
      details: error?.details || {
        dbErrorMessage: message,
        expectedFormat: 'HH:mm:ss',
        acceptedFormats: [
          'HH:mm:ss',
          'HH:mm',
          'ISO-8601 datetime',
          'DateTime string'
        ],
        examples: [
          '23:05:12',
          '23:05',
          '2026-06-15T23:05:12.000Z'
        ]
      }
    });
  }

  return createAttendanceError({
    status: 500,
    code: 'ATTENDANCE_SAVE_ERROR',
    message: 'No se pudo registrar la asistencia.',
    details: {}
  });
}

class AttendanceRepository {
  async getTodayCheckIn(workerId, date, companyId = null) {
    const res = await query(
      `SELECT ar.*, p.name as project_name, wl.name as work_location_name
       FROM attendance_records ar
       LEFT JOIN projects p ON ar.project_id = p.id
       LEFT JOIN work_locations wl ON ar.work_location_id = wl.id
       WHERE ar.worker_id = $1
         AND ar.date = $2::date
         AND ($3::uuid IS NULL OR ar.company_id = $3)
       ORDER BY ar.created_at DESC
       LIMIT 1`,
      [workerId, date, companyId]
    );
    return res.rows[0];
  }

  async createCheckIn(data) {
    let row;
    try {
      row = await insertReturning({ query }, 'attendance_records', {
        worker_id: data.worker_id,
        user_id: data.user_id,
        company_id: data.company_id,
        project_id: data.project_id || null,
        work_location_id: data.work_location_id || null,
        check_in_session_id: data.session_id || null,
        check_in_device_source: data.device_source || null,
        shift_id: data.shift_id,
        labor_policy_id: data.labor_policy_id,
        date: data.attendance_date,
        status: data.status,
        late_minutes: data.late_minutes,
        scheduled_check_in: data.scheduled_check_in,
        scheduled_check_out: data.scheduled_check_out,
        tolerance_minutes: data.tolerance_minutes,
        expected_minutes: data.expected_minutes,
        break_minutes: data.break_minutes,
        break_paid: data.break_paid,
        calculation_details: data.calculation_details,
        check_in_time: data.check_in_at || data.check_in_time,
        check_in_at: data.check_in_at || null,
        check_in_source_format: data.check_in_source_format || null,
        check_in_latitude: data.latitude,
        check_in_longitude: data.longitude,
        check_in_gps_accuracy: data.gps_accuracy,
        check_in_device_id: data.device_id,
        check_in_ip_address: data.ip_address,
        check_in_user_agent: data.user_agent,
        check_in_photo_url: data.photo_url,
        check_in_is_mock_location: data.is_mock_location,
        check_in_out_of_range: data.out_of_range,
        check_in_distance_meters: data.distance_meters,
        check_in_allowed_radius_meters: data.allowed_radius_meters,
        check_in_location_valid: data.is_location_valid,
        check_in_location_validation_message: data.location_validation_message,
        check_in_device_info: data.device_info || null,
        check_in_assignment_source: data.assignment_source || null,
        check_in_validation_status: data.validation_status || null,
        check_in_server_time: new Date()
      });
    } catch (error) {
      throw mapAttendanceSaveError(error);
    }
    
    if (row) {
      if (row.project_id) {
        const pRes = await query('SELECT name FROM projects WHERE id = $1', [row.project_id]);
        row.project_name = pRes.rows[0]?.name;
      }
      if (row.work_location_id) {
        const wlRes = await query('SELECT name FROM work_locations WHERE id = $1', [row.work_location_id]);
        row.work_location_name = wlRes.rows[0]?.name;
      }
    }
    return row;
  }

  async updateCheckOut(id, data) {
    let row;
    try {
      row = await updateReturning({ query }, 'attendance_records', 'id', id, {
        check_out_time: data.check_out_at || data.check_out_time,
        check_out_at: data.check_out_at || null,
        check_out_source_format: data.check_out_source_format || null,
        check_out_session_id: data.session_id || null,
        check_out_device_source: data.device_source || null,
        check_out_latitude: data.latitude,
        check_out_longitude: data.longitude,
        check_out_gps_accuracy: data.gps_accuracy,
        check_out_device_id: data.device_id,
        check_out_ip_address: data.ip_address,
        check_out_user_agent: data.user_agent,
        check_out_photo_url: data.photo_url,
        check_out_is_mock_location: data.is_mock_location,
        check_out_out_of_range: data.out_of_range,
        check_out_distance_meters: data.distance_meters,
        check_out_allowed_radius_meters: data.allowed_radius_meters,
        check_out_location_valid: data.is_location_valid,
        check_out_location_validation_message: data.location_validation_message,
        check_out_device_info: data.device_info || null,
        check_out_assignment_source: data.assignment_source || null,
        check_out_validation_status: data.validation_status || null,
        check_out_server_time: new Date(),
        worked_minutes: data.worked_minutes,
        worked_hours: data.worked_hours,
        effective_worked_minutes: data.effective_worked_minutes,
        overtime_minutes: data.overtime_minutes,
        early_leave_minutes: data.early_leave_minutes,
        late_minutes: data.late_minutes,
        scheduled_check_in: data.scheduled_check_in,
        scheduled_check_out: data.scheduled_check_out,
        tolerance_minutes: data.tolerance_minutes,
        expected_minutes: data.expected_minutes,
        break_minutes: data.break_minutes,
        break_paid: data.break_paid,
        calculation_details: data.calculation_details,
        status: data.status,
        updated_at: new Date()
      });
    } catch (error) {
      throw mapAttendanceSaveError(error);
    }
    
    if (row) {
      if (row.project_id) {
        const pRes = await query('SELECT name FROM projects WHERE id = $1', [row.project_id]);
        row.project_name = pRes.rows[0]?.name;
      }
      if (row.work_location_id) {
        const wlRes = await query('SELECT name FROM work_locations WHERE id = $1', [row.work_location_id]);
        row.work_location_name = wlRes.rows[0]?.name;
      }
    }
    return row;
  }

  async getProject(projectId, companyId) {
    const res = await query(`SELECT latitude, longitude, allowed_radius_meters FROM projects WHERE id = $1 AND company_id = $2`, [projectId, companyId]);
    return res.rows[0];
  }

  async getWorkerWorkLocation(workerId, companyId) {
    const res = await query(
      `SELECT w.id AS worker_id,
              w.company_id,
              w.work_location_id,
              wl.name,
              wl.latitude,
              wl.longitude,
              wl.allowed_radius_meters,
              COALESCE(wl.is_active, wl.status, TRUE) AS is_active
       FROM workers w
       LEFT JOIN work_locations wl ON wl.id = w.work_location_id AND wl.deleted_at IS NULL
       WHERE w.id = $1
         AND w.company_id = $2
         AND w.deleted_at IS NULL`,
      [workerId, companyId]
    );
    return res.rows[0] || null;
  }

  async logLocationAttempt(data) {
    try {
      await insertReturning({ query }, 'attendance_location_attempts', {
        company_id: data.company_id,
        worker_id: data.worker_id,
        user_id: data.user_id,
        work_location_id: data.work_location_id || null,
        type: data.type,
        latitude: data.latitude,
        longitude: data.longitude,
        accuracy: data.accuracy,
        distance_meters: data.distance_meters,
        allowed_radius_meters: data.allowed_radius_meters,
        is_location_valid: data.is_location_valid,
        validation_message: data.validation_message,
        device_info: data.device_info || null,
        ip_address: data.ip_address,
        user_agent: data.user_agent
      });
    } catch (error) {
      console.error('[ATTENDANCE] Could not log location attempt:', error.message);
    }
  }

  async logCorrection(data) {
    await query(`
      INSERT INTO attendance_corrections (attendance_record_id, company_id, corrected_by, old_data, new_data, reason, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'applied')
    `, [data.record_id, data.company_id, data.corrected_by, data.old_data, data.new_data, data.reason]);
  }
  async upsertManualCorrection(data) {
    try {
      const result = await query(`
        INSERT INTO attendance_records (
          worker_id, company_id, date, status,
          check_in_time, check_out_time, check_in_at, check_out_at,
          late_minutes, expected_minutes, worked_minutes,
          worked_hours, hours_worked, effective_worked_minutes,
          break_minutes, break_paid, overtime_minutes, early_leave_minutes,
          shift_id, scheduled_check_in, scheduled_check_out,
          tolerance_minutes, is_manual_correction
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7, $8,
          $9, $10, $11,
          $12, $13, $14,
          $15, $16, $17, $18,
          $19, $20, $21,
          $22, true
        )
        ON CONFLICT (worker_id, date) DO UPDATE SET
          status = EXCLUDED.status,
          check_in_time = EXCLUDED.check_in_time,
          check_out_time = EXCLUDED.check_out_time,
          check_in_at = EXCLUDED.check_in_at,
          check_out_at = EXCLUDED.check_out_at,
          late_minutes = EXCLUDED.late_minutes,
          expected_minutes = EXCLUDED.expected_minutes,
          worked_minutes = EXCLUDED.worked_minutes,
          worked_hours = EXCLUDED.worked_hours,
          hours_worked = EXCLUDED.hours_worked,
          effective_worked_minutes = EXCLUDED.effective_worked_minutes,
          break_minutes = EXCLUDED.break_minutes,
          break_paid = EXCLUDED.break_paid,
          overtime_minutes = EXCLUDED.overtime_minutes,
          early_leave_minutes = EXCLUDED.early_leave_minutes,
          shift_id = EXCLUDED.shift_id,
          scheduled_check_in = EXCLUDED.scheduled_check_in,
          scheduled_check_out = EXCLUDED.scheduled_check_out,
          tolerance_minutes = EXCLUDED.tolerance_minutes,
          is_manual_correction = true,
          updated_at = NOW()
        RETURNING *
      `, [
        data.worker_id, data.company_id, data.date, data.status,
        data.check_in_time, data.check_out_time, data.check_in_at, data.check_out_at,
        data.late_minutes, data.expected_minutes, data.worked_minutes,
        data.worked_hours, data.hours_worked, data.effective_worked_minutes,
        data.break_minutes, data.break_paid, data.overtime_minutes, data.early_leave_minutes,
        data.shift_id, data.scheduled_check_in, data.scheduled_check_out,
        data.tolerance_minutes
      ]);
      return result.rows[0];
    } catch (error) {
      throw mapAttendanceSaveError(error);
    }
  }
}

module.exports = new AttendanceRepository();
