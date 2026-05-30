const { query } = require('../../../config/database');
const { insertReturning, updateReturning } = require('../../../utils/db.util');

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
    const row = await insertReturning({ query }, 'attendance_records', {
      worker_id: data.worker_id,
      user_id: data.user_id,
      company_id: data.company_id,
      project_id: data.project_id || null,
      work_location_id: data.work_location_id || null,
      shift_id: data.shift_id,
      date: data.attendance_date,
      status: data.status,
      late_minutes: data.late_minutes,
      check_in_time: new Date(),
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
    const row = await updateReturning({ query }, 'attendance_records', 'id', id, {
      check_out_time: new Date(),
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
      overtime_minutes: data.overtime_minutes,
      status: data.status,
      updated_at: new Date()
    });
    
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
}

module.exports = new AttendanceRepository();
