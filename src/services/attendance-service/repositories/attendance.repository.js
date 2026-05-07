const { query } = require('../../../config/database');

class AttendanceRepository {
  async getTodayCheckIn(workerId, date, companyId = null) {
    const res = await query(
      `SELECT ar.*, p.name as project_name 
       FROM attendance_records ar
       LEFT JOIN projects p ON ar.project_id = p.id
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
    const res = await query(`
      INSERT INTO attendance_records (
        worker_id, user_id, company_id, project_id, shift_id, date, status, late_minutes,
        check_in_time, check_in_latitude, check_in_longitude, check_in_gps_accuracy,
        check_in_device_id, check_in_ip_address, check_in_user_agent, check_in_photo_url,
        check_in_is_mock_location, check_in_out_of_range, check_in_distance_meters
      ) VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, NOW(), $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING *
    `, [
      data.worker_id, data.user_id, data.company_id, data.project_id, data.shift_id, data.attendance_date, data.status, data.late_minutes,
      data.latitude, data.longitude, data.gps_accuracy, data.device_id, data.ip_address, data.user_agent, data.photo_url,
      data.is_mock_location, data.out_of_range, data.distance_meters
    ]);
    
    if (res.rows[0]) {
      const pRes = await query('SELECT name FROM projects WHERE id = $1', [res.rows[0].project_id]);
      res.rows[0].project_name = pRes.rows[0]?.name;
    }
    return res.rows[0];
  }

  async updateCheckOut(id, data) {
    const res = await query(`
      UPDATE attendance_records SET
        check_out_time = NOW(), check_out_latitude = $1, check_out_longitude = $2, check_out_gps_accuracy = $3,
        check_out_device_id = $4, check_out_ip_address = $5, check_out_user_agent = $6, check_out_photo_url = $7,
        check_out_is_mock_location = $8, check_out_out_of_range = $9, check_out_distance_meters = $10,
        worked_minutes = $11, worked_hours = $12, overtime_minutes = $13, status = $14, updated_at = NOW()
      WHERE id = $15 RETURNING *
    `, [
      data.latitude, data.longitude, data.gps_accuracy, data.device_id, data.ip_address, data.user_agent, data.photo_url,
      data.is_mock_location, data.out_of_range, data.distance_meters, data.worked_minutes, data.worked_hours, data.overtime_minutes,
      data.status, id
    ]);
    
    if (res.rows[0]) {
      const pRes = await query('SELECT name FROM projects WHERE id = $1', [res.rows[0].project_id]);
      res.rows[0].project_name = pRes.rows[0]?.name;
    }
    return res.rows[0];
  }

  async getProject(projectId, companyId) {
    const res = await query(`SELECT latitude, longitude, allowed_radius_meters FROM projects WHERE id = $1 AND company_id = $2`, [projectId, companyId]);
    return res.rows[0];
  }

  async logCorrection(data) {
    await query(`
      INSERT INTO attendance_corrections (attendance_record_id, company_id, corrected_by, old_data, new_data, reason, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'applied')
    `, [data.record_id, data.company_id, data.corrected_by, data.old_data, data.new_data, data.reason]);
  }
}

module.exports = new AttendanceRepository();
