const { query } = require('../../../config/database');
const { formatDateTimeParts, EMPTY_VALUE } = require('../utils/workCrewReportFormatter');

const WORK_CREW_REPORT_COLUMNS = {
  worker_name: { key: 'worker_name', label: 'Trabajador', widthRatio: 0.18 },
  worker_document: { key: 'worker_document', label: 'Documento', widthRatio: 0.10 },
  worker_email: { key: 'worker_email', label: 'Correo', widthRatio: 0.16 },
  crew_name: { key: 'crew_name', label: 'Cuadrilla', widthRatio: 0.14 },
  supervisor_name: { key: 'supervisor_name', label: 'Supervisor', widthRatio: 0.14 },
  current_location_name: { key: 'current_location_name', label: 'Obra Actual', widthRatio: 0.14 },
  assignment_status: { key: 'assignment_status', label: 'Estado', widthRatio: 0.10 },
  assigned_date: { key: 'assigned_date', label: 'Fecha ingreso', widthRatio: 0.09 },
  assigned_time: { key: 'assigned_time', label: 'Hora ingreso', widthRatio: 0.08 },
  temporary_end_date: { key: 'temporary_end_date', label: 'Fecha fin', widthRatio: 0.09 },
  temporary_end_time: { key: 'temporary_end_time', label: 'Hora fin', widthRatio: 0.08 },
  reason: { key: 'reason', label: 'Motivo', widthRatio: 0.16 }
};

const WORK_CREW_DEFAULT_COLUMNS = [
  'worker_name',
  'worker_document',
  'crew_name',
  'current_location_name',
  'assignment_status',
  'assigned_date',
  'assigned_time',
  'temporary_end_date',
  'temporary_end_time'
];

const WORK_CREW_COLUMN_ALIASES = {
  document: 'worker_document',
  assigned_at: 'assigned_date',
  start_date: 'assigned_date',
  start_time: 'assigned_time',
  end_date: 'temporary_end_date',
  end_time: 'temporary_end_time'
};

function normalizeWorkCrewReportColumns(columns) {
  let requested = columns;
  if (typeof requested === 'string') {
    requested = requested.split(',').map((column) => column.trim());
  }

  if (!Array.isArray(requested) || requested.length === 0) {
    requested = WORK_CREW_DEFAULT_COLUMNS;
  }

  const selected = requested
    .map((column) => WORK_CREW_COLUMN_ALIASES[column] || column)
    .filter((column, index, list) => WORK_CREW_REPORT_COLUMNS[column] && list.indexOf(column) === index);

  return selected.length > 0 ? selected : WORK_CREW_DEFAULT_COLUMNS;
}

function pickColumns(row, columns) {
  return columns.reduce((mapped, column) => {
    mapped[column] = row[column];
    return mapped;
  }, {});
}

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
        SUM(CASE
          WHEN a.effective_worked_minutes IS NOT NULL THEN a.effective_worked_minutes::numeric / 60.0
          ELSE COALESCE(a.worked_hours, 0)
        END) as total_worked_hours
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
             a.name as department_name, jp.name as job_title
      FROM workers w
      JOIN users u ON w.user_id = u.id
      LEFT JOIN job_positions jp ON w.job_position_id = jp.id
      LEFT JOIN areas a ON a.id = COALESCE(w.area_id, jp.area_id)
      WHERE w.company_id = $1
    `;
    const params = [tenantId];
    
    if (filters.status) { params.push(filters.status); q += ` AND w.status = $${params.length}`; }
    if (filters.department_id) { params.push(filters.department_id); q += ` AND COALESCE(w.area_id, jp.area_id) = $${params.length}`; }

    q += ` ORDER BY u.first_name ASC`;
    const res = await query(q, params);
    return res.rows;
  }

  async getWorkCrewsData(tenantId, filters = {}) {
    const params = [tenantId];
    const where = ['wc.company_id = $1', 'wc.deleted_at IS NULL'];

    if (filters.status && filters.status !== 'all') {
      const isActive = ['active', 'true', '1'].includes(String(filters.status).toLowerCase());
      where.push(`COALESCE(wc.is_active, wc.status, TRUE) = $${params.length + 1}`);
      params.push(isActive);
    } else if (!(filters.include_inactive === true || filters.include_inactive === 'true')) {
      where.push('COALESCE(wc.is_active, wc.status, TRUE) = TRUE');
    }

    if (filters.work_location_id) {
      params.push(filters.work_location_id);
      where.push(`wc.work_location_id = $${params.length}`);
    }

    if (filters.supervisor_id) {
      params.push(filters.supervisor_id);
      where.push(`wc.supervisor_id = $${params.length}`);
    }

    if (filters.search) {
      params.push(`%${String(filters.search).trim()}%`);
      where.push(`(
        wc.name ILIKE $${params.length}
        OR COALESCE(wc.description, '') ILIKE $${params.length}
        OR wl.name ILIKE $${params.length}
        OR CONCAT_WS(' ', u.first_name, u.last_name) ILIKE $${params.length}
      )`);
    }

    const res = await query(
      `SELECT wc.id,
              wc.name,
              wc.description,
              CASE WHEN COALESCE(wc.is_active, wc.status, TRUE) THEN 'Activa' ELSE 'Inactiva' END AS status,
              wl.name AS work_location_name,
              CONCAT_WS(' ', u.first_name, u.last_name) AS supervisor_name,
              u.email AS supervisor_email,
              COUNT(cw.id) FILTER (WHERE cw.is_active = TRUE AND cw.unassigned_at IS NULL)::int AS active_workers_count,
              wc.created_at
       FROM work_crews wc
       JOIN work_locations wl ON wl.id = wc.work_location_id
       JOIN users u ON u.id = wc.supervisor_id
       LEFT JOIN crew_workers cw ON cw.crew_id = wc.id AND cw.company_id = wc.company_id
       WHERE ${where.join(' AND ')}
       GROUP BY wc.id, wl.id, u.id
       ORDER BY wc.name ASC`,
      params
    );

    return res.rows;
  }

  getWorkCrewReportColumns() {
    return Object.values(WORK_CREW_REPORT_COLUMNS);
  }

  async getWorkCrewMovementReportData(tenantId, body = {}, { isExport = false } = {}) {
    const filters = body.filters || {};
    const selectedColumns = normalizeWorkCrewReportColumns(body.columns);
    const page = Math.max(parseInt(body.page, 10) || 1, 1);
    const pageSize = isExport ? 100000 : Math.min(Math.max(parseInt(body.pageSize || body.limit, 10) || 50, 1), 500);
    const offset = (page - 1) * pageSize;

    const params = [tenantId];
    const where = [
      'cw.company_id = $1',
      'cw.is_active = TRUE',
      'cw.unassigned_at IS NULL',
      'wc.deleted_at IS NULL',
      'COALESCE(wc.is_active, wc.status, TRUE) = TRUE',
      'w.deleted_at IS NULL',
      'COALESCE(w.is_active, TRUE) = TRUE',
      "COALESCE(w.employment_status, 'active') = 'active'"
    ];

    if (filters.search) {
      params.push(`%${String(filters.search).trim()}%`);
      where.push(`(
        CONCAT_WS(' ', u.first_name, u.last_name) ILIKE $${params.length}
        OR COALESCE(w.document_number, w.personal_id, '') ILIKE $${params.length}
        OR COALESCE(u.email, '') ILIKE $${params.length}
        OR wc.name ILIKE $${params.length}
      )`);
    }

    if (filters.crew_id) {
      params.push(filters.crew_id);
      where.push(`wc.id = $${params.length}`);
    }

    if (filters.work_location_id) {
      params.push(filters.work_location_id);
      where.push(`COALESCE(temp.work_location_id, wc.work_location_id) = $${params.length}`);
    }

    if (filters.assignment_type && filters.assignment_type !== 'all') {
      if (filters.assignment_type === 'temporary_transfer') {
        where.push('temp.assignment_id IS NOT NULL');
      } else if (filters.assignment_type === 'main_location') {
        where.push('temp.assignment_id IS NULL');
      }
    }

    const dateRange = filters.date_range || {};
    if (dateRange.start) {
      params.push(dateRange.start);
      where.push(`COALESCE(temp.start_date, cw.assigned_at::date) >= $${params.length}::date`);
    }
    if (dateRange.end) {
      params.push(dateRange.end);
      where.push(`COALESCE(temp.start_date, cw.assigned_at::date) <= $${params.length}::date`);
    }

    const fromSql = `
      FROM crew_workers cw
      JOIN work_crews wc ON wc.id = cw.crew_id AND wc.company_id = cw.company_id
      JOIN workers w ON w.id = cw.worker_id AND w.company_id = cw.company_id
      JOIN users u ON u.id = w.user_id
      JOIN users supervisor ON supervisor.id = wc.supervisor_id
      JOIN work_locations base_wl ON base_wl.id = wc.work_location_id
      LEFT JOIN LATERAL (
        SELECT wla.id AS assignment_id,
               wla.work_location_id,
               wla.start_date,
               wla.end_date,
               wla.reason,
               wl.name AS work_location_name
        FROM worker_location_assignments wla
        JOIN work_locations wl ON wl.id = wla.work_location_id
        WHERE wla.company_id = cw.company_id
          AND wla.worker_id = cw.worker_id
          AND wla.assignment_type = 'temporary'
          AND wla.is_active = TRUE
          AND wla.start_date <= CURRENT_DATE
          AND (wla.end_date IS NULL OR wla.end_date >= CURRENT_DATE)
          AND wl.company_id = cw.company_id
          AND wl.deleted_at IS NULL
          AND COALESCE(wl.is_active, wl.status, TRUE) = TRUE
        ORDER BY wla.created_at DESC
        LIMIT 1
      ) temp ON TRUE
      WHERE ${where.join(' AND ')}
    `;

    const countRes = await query(`SELECT COUNT(*)::int AS count ${fromSql}`, params);
    const dataRes = await query(
      `SELECT cw.worker_id,
              CONCAT_WS(' ', u.first_name, u.last_name) AS worker_name,
              COALESCE(w.document_number, w.personal_id) AS worker_document,
              u.email AS worker_email,
              wc.id AS crew_id,
              wc.name AS crew_name,
              CONCAT_WS(' ', supervisor.first_name, supervisor.last_name) AS supervisor_name,
              COALESCE(temp.work_location_name, base_wl.name) AS current_location_name,
              CASE WHEN temp.assignment_id IS NOT NULL THEN 'Transferido (Temporal)' ELSE 'Obra Principal' END AS assignment_status,
              cw.assigned_at,
              temp.end_date::text AS temporary_end_date,
              temp.reason AS reason
       ${fromSql}
       ORDER BY wc.name ASC, worker_name ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset]
    );

    const rows = dataRes.rows.map((row) => {
      const assignedAt = formatDateTimeParts(row.assigned_at);
      const temporaryEnd = formatDateTimeParts(row.temporary_end_date);

      return {
        ...row,
        assigned_date: assignedAt.date,
        assigned_time: assignedAt.time,
        temporary_end_date: temporaryEnd.date,
        temporary_end_time: temporaryEnd.time,
        reason: row.reason || EMPTY_VALUE
      };
    });

    const filteredRows = rows.map((row) => pickColumns(row, selectedColumns));

    return {
      data: filteredRows,
      rows,
      total: countRes.rows[0]?.count || 0,
      page,
      pageSize,
      totalPages: Math.ceil((countRes.rows[0]?.count || 0) / pageSize),
      selectedColumns,
      columns: selectedColumns.map((column) => WORK_CREW_REPORT_COLUMNS[column])
    };
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
    const requestReportService = require('../../request-service/services/requestReport.service');
    // Normalize date filters coming from query parameters to match the ones expected by getReportData
    const dateFrom = filters.start_date || filters.dateFrom;
    const dateTo = filters.end_date || filters.dateTo;
    
    const body = {
      filters: {
        ...filters,
        dateFrom,
        dateTo
      },
      columns: ['worker_name', 'request_type', 'status', 'start_date', 'end_date', 'days_requested', 'reason', 'created_at', 'approved_by', 'department_name', 'job_title']
    };
    
    const { data } = await requestReportService.getReportData(body, tenantId, { roles: ['ADMIN'] }, true);
    
    return data.map(row => ({
      ...row,
      full_name: row.worker_name
    }));
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
