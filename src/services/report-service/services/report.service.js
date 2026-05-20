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

  async getWorkersData(tenantId, filters) {
    let q = `
      SELECT w.id, CONCAT_WS(' ', u.first_name, u.last_name) AS full_name,
             u.email, w.document_type, w.document_number, w.phone_number, w.hire_date, w.status,
             d.name as department_name, jp.title as job_title
      FROM workers w
      JOIN users u ON w.user_id = u.id
      LEFT JOIN job_positions jp ON w.job_position_id = jp.id
      LEFT JOIN departments d ON jp.department_id = d.id
      WHERE w.company_id = $1
    `;
    const params = [tenantId];
    
    if (filters.status) { params.push(filters.status); q += ` AND w.status = $${params.length}`; }
    if (filters.department_id) { params.push(filters.department_id); q += ` AND jp.department_id = $${params.length}`; }

    q += ` ORDER BY u.first_name ASC`;
    const res = await query(q, params);
    return res.rows;
  }

  async getPayrollData(tenantId, filters) {
    let q = `
      SELECT pr.id, CONCAT_WS(' ', u.first_name, u.last_name) AS full_name,
             u.email, pp.name as period_name, 
             pr.base_salary AS basic_salary, 
             (pr.base_salary + pr.bonuses) AS gross_salary, 
             pr.deductions AS deductions_total, 
             pr.net_estimated AS net_salary, 
             pp.status AS status
      FROM payroll_records pr
      JOIN workers w ON pr.worker_id = w.id
      JOIN users u ON w.user_id = u.id
      JOIN payroll_periods pp ON pr.payroll_period_id = pp.id
      WHERE pp.company_id = $1
    `;
    const params = [tenantId];
    
    if (filters.payroll_period_id) { params.push(filters.payroll_period_id); q += ` AND pr.payroll_period_id = $${params.length}`; }
    if (filters.status) { params.push(filters.status); q += ` AND pp.status = $${params.length}`; }

    q += ` ORDER BY u.first_name ASC`;
    const res = await query(q, params);
    return res.rows;
  }

  async getRequestsData(tenantId, filters) {
    let q = `
      SELECT r.id, CONCAT_WS(' ', u.first_name, u.last_name) AS full_name,
             rt.name as request_type, r.start_date, r.end_date, r.days_requested, r.status, r.reason
      FROM employee_requests r
      JOIN workers w ON r.worker_id = w.id
      JOIN users u ON w.user_id = u.id
      JOIN request_types rt ON r.request_type_id = rt.id
      WHERE r.company_id = $1
    `;
    const params = [tenantId];
    
    if (filters.start_date) { params.push(filters.start_date); q += ` AND r.start_date >= $${params.length}`; }
    if (filters.end_date) { params.push(filters.end_date); q += ` AND r.end_date <= $${params.length}`; }
    if (filters.status) { params.push(filters.status); q += ` AND r.status = $${params.length}`; }
    if (filters.worker_id) { params.push(filters.worker_id); q += ` AND r.worker_id = $${params.length}`; }

    q += ` ORDER BY r.start_date DESC`;
    const res = await query(q, params);
    return res.rows;
  }

  async getVacationsData(tenantId, filters) {
    let q = `
      SELECT v.id, CONCAT_WS(' ', u.first_name, u.last_name) AS full_name,
             u.email, v.start_date, v.end_date, v.total_days, v.status,
             CONCAT_WS(' ', u2.first_name, u2.last_name) AS approved_by_name
      FROM vacations v
      JOIN workers w ON v.worker_id = w.id
      JOIN users u ON w.user_id = u.id
      LEFT JOIN users u2 ON v.approved_by = u2.id
      WHERE v.company_id = $1
    `;
    const params = [tenantId];
    if (filters.status) { params.push(filters.status); q += ` AND v.status = $${params.length}`; }
    if (filters.start_date) { params.push(filters.start_date); q += ` AND v.start_date >= $${params.length}`; }
    if (filters.end_date) { params.push(filters.end_date); q += ` AND v.end_date <= $${params.length}`; }

    q += ` ORDER BY v.start_date DESC`;
    const res = await query(q, params);
    return res.rows;
  }

  async getDocumentsData(tenantId, filters) {
    let q = `
      SELECT d.id, CONCAT_WS(' ', u.first_name, u.last_name) AS full_name,
             u.email, dt.name as document_type_name, d.file_url, d.status, d.uploaded_at
      FROM documents d
      JOIN workers w ON d.worker_id = w.id
      JOIN users u ON w.user_id = u.id
      JOIN document_types dt ON d.document_type_id = dt.id
      WHERE w.company_id = $1
    `;
    const params = [tenantId];
    if (filters.status) { params.push(filters.status); q += ` AND d.status = $${params.length}`; }
    if (filters.document_type_id) { params.push(filters.document_type_id); q += ` AND d.document_type_id = $${params.length}`; }

    q += ` ORDER BY d.uploaded_at DESC`;
    const res = await query(q, params);
    return res.rows;
  }
}

module.exports = new ReportService();
