const { query } = require('../../../config/database');

class ReportService {
  async getAttendanceData(tenantId, filters) {
    let q = `
      SELECT a.id, a.check_in_time, a.check_out_time, a.status, a.late_minutes, a.worked_hours,
             CONCAT_WS(' ', u.first_name, u.last_name) AS full_name,
             u.email, p.name as project_name
      FROM attendance_records a
      JOIN workers w ON a.worker_id = w.id
      JOIN users u ON w.user_id = u.id
      LEFT JOIN projects p ON a.project_id = p.id
      WHERE a.company_id = $1 AND a.date >= w.hire_date
    `;
    const params = [tenantId];
    
    if (filters.start_date) { params.push(filters.start_date); q += ` AND a.date >= $${params.length}`; }
    if (filters.end_date) { params.push(filters.end_date); q += ` AND a.date <= $${params.length}`; }
    if (filters.worker_id) { params.push(filters.worker_id); q += ` AND a.worker_id = $${params.length}`; }

    q += ` ORDER BY a.check_in_time DESC`;
    const res = await query(q, params);
    return res.rows;
  }

  async getMonthlySummaryData(tenantId, filters) {
    // Este reporte es vital para Payroll: Agrupa por worker_id y suma KPIs.
    let q = `
      SELECT 
        a.worker_id,
        CONCAT_WS(' ', u.first_name, u.last_name) AS full_name,
        u.email,
        COUNT(a.id) as total_days,
        SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) as days_present,
        SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) as days_absent,
        SUM(CASE WHEN a.status = 'late' THEN 1 ELSE 0 END) as days_late,
        SUM(a.late_minutes) as total_late_minutes,
        SUM(a.worked_hours) as total_worked_hours
      FROM attendance_records a
      JOIN workers w ON a.worker_id = w.id
      JOIN users u ON w.user_id = u.id
      WHERE a.company_id = $1 AND a.date >= w.hire_date
    `;
    const params = [tenantId];
    
    if (filters.start_date) { params.push(filters.start_date); q += ` AND a.date >= $${params.length}`; }
    if (filters.end_date) { params.push(filters.end_date); q += ` AND a.date <= $${params.length}`; }

    q += ` GROUP BY a.worker_id, u.first_name, u.last_name, u.email ORDER BY u.first_name ASC, u.last_name ASC`;
    const res = await query(q, params);
    return res.rows;
  }
}

module.exports = new ReportService();
