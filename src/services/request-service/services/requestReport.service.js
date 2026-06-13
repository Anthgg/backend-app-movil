const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { query } = require('../../../config/database');
const moment = require('moment');
const { getCompanySettings } = require('../../company-settings-service/companySettings.service');

const ALLOWED_COLUMNS = {
  worker_name: { key: 'worker_name', label: 'Trabajador' },
  request_type: { key: 'request_type', label: 'Tipo de Solicitud' },
  status: { key: 'status', label: 'Estado' },
  start_date: { key: 'start_date', label: 'Fecha Inicio' },
  end_date: { key: 'end_date', label: 'Fecha Fin' },
  created_at: { key: 'created_at', label: 'Fecha Creación' },
  approved_by: { key: 'approved_by', label: 'Aprobado Por' },
  days_requested: { key: 'days_requested', label: 'Días Solicitados' },
  reason: { key: 'reason', label: 'Motivo' },
  department_name: { key: 'department_name', label: 'Área/Departamento' },
  job_title: { key: 'job_title', label: 'Puesto' }
};

const STATUS_MAP = {
  'draft': 'Borrador',
  'pending': 'Pendiente',
  'pending_supervisor': 'Pendiente Supervisor',
  'pending_rrhh': 'Pendiente RRHH',
  'observed': 'Observado',
  'approved': 'Aprobado',
  'rejected': 'Rechazado',
  'cancelled': 'Cancelado'
};

const COLUMN_ALIASES = {
  // Trabajador
  'worker_name': 'worker_name',
  'workerName': 'worker_name',
  'worker.fullName': 'worker_name',
  // Tipo de Solicitud
  'request_type': 'request_type',
  'requestType': 'request_type',
  'type.name': 'request_type',
  // Estado
  'status': 'status',
  // Fecha Inicio
  'start_date': 'start_date',
  'startDate': 'start_date',
  // Fecha Fin
  'end_date': 'end_date',
  'endDate': 'end_date',
  // Fecha Creación
  'created_at': 'created_at',
  'createdAt': 'created_at',
  // Aprobado Por
  'approved_by': 'approved_by',
  'approvedBy': 'approved_by',
  'approver.fullName': 'approved_by',
  // Días Solicitados
  'days_requested': 'days_requested',
  'requested_days': 'days_requested',
  'requestedDays': 'days_requested',
  // Motivo
  'reason': 'reason',
  // Área / Departamento
  'department_name': 'department_name',
  'area_department': 'department_name',
  'areaDepartment': 'department_name',
  'area.name': 'department_name',
  'department.name': 'department_name',
  // Puesto
  'job_title': 'job_title',
  'position': 'job_title',
  'position.name': 'job_title'
};

const requestReportRowMapper = (row) => {
  const formatDate = (val) => {
    if (!val) return 'N/A';
    try {
      if (typeof val === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(val)) return val;
      return new Date(val).toISOString().slice(0, 10);
    } catch {
      return val;
    }
  };

  const workerName = row.worker_name || row.full_name || 'N/A';
  const requestType = row.request_type || row.requestType || 'N/A';
  const status = STATUS_MAP[row.status] || row.status || 'N/A';
  const startDate = formatDate(row.start_date || row.startDate);
  const endDate = formatDate(row.end_date || row.endDate);
  const createdAt = formatDate(row.created_at || row.createdAt);
  const approvedBy = row.approved_by || row.approvedBy || 'N/A';
  const requestedDays = row.days_requested !== null && row.days_requested !== undefined
    ? row.days_requested
    : (row.requested_days !== null && row.requested_days !== undefined ? row.requested_days : (row.requestedDays !== null && row.requestedDays !== undefined ? row.requestedDays : 'N/A'));
  const reason = row.reason || 'N/A';
  const areaDepartment = row.department_name || row.area_department || row.areaDepartment || 'N/A';
  const position = row.job_title || row.position || 'N/A';

  // Helper to create objects that act as strings but support properties
  const createStringWrapper = (strValue, propKey, propValue) => {
    const wrapper = new String(strValue || 'N/A');
    wrapper[propKey] = propValue || 'N/A';
    return wrapper;
  };

  const worker = createStringWrapper(workerName, 'fullName', workerName);
  const type = createStringWrapper(requestType, 'name', requestType);
  const approver = createStringWrapper(approvedBy, 'fullName', approvedBy);
  const area = createStringWrapper(areaDepartment, 'name', areaDepartment);
  const department = createStringWrapper(areaDepartment, 'name', areaDepartment);
  const positionObj = createStringWrapper(position, 'name', position);

  const mapped = {
    // CamelCase
    workerName,
    requestType,
    status,
    startDate,
    endDate,
    createdAt,
    approvedBy,
    requestedDays,
    reason,
    areaDepartment,
    position: positionObj,

    // SnakeCase
    worker_name: workerName,
    request_type: requestType,
    start_date: startDate,
    end_date: endDate,
    created_at: createdAt,
    approved_by: approvedBy,
    requested_days: requestedDays,
    days_requested: requestedDays,
    reason,
    area_department: areaDepartment,
    department_name: areaDepartment,
    job_title: positionObj,

    // Nested structures
    worker,
    type,
    approver,
    area,
    department
  };

  // String dot-notation keys
  mapped['worker.fullName'] = workerName;
  mapped['type.name'] = requestType;
  mapped['approver.fullName'] = approvedBy;
  mapped['area.name'] = areaDepartment;
  mapped['department.name'] = areaDepartment;
  mapped['position.name'] = position;

  return mapped;
};

class RequestReportService {
  getAvailableColumns() {
    return Object.values(ALLOWED_COLUMNS);
  }

  requestReportRowMapper(row) {
    return requestReportRowMapper(row);
  }

  /**
   * Core logic to retrieve, filter, validate, and format request report data.
   * This is shared identically by the preview, excel, and pdf exporters.
   */
  async getReportData(body, tenantId, user, isExport = false) {
    const filters = body.filters || {};
    const { dateFrom, dateTo, status, requestType, workerId, areaId } = filters;
    
    // Parse pagination/limits
    const page = Math.max(parseInt(body.page, 10) || 1, 1);
    const limit = isExport ? 100000 : Math.max(parseInt(body.limit, 10) || 20, 1);
    const offset = (page - 1) * limit;

    // Validate and map columns
    let reqColumns = body.columns;
    if (typeof reqColumns === 'string') {
        reqColumns = reqColumns.split(',').map(c => c.trim());
    }
    if (!Array.isArray(reqColumns) || reqColumns.length === 0) {
        reqColumns = ['worker_name', 'request_type', 'status', 'start_date', 'end_date'];
    }
    
    const selectedColumns = reqColumns.filter(col => COLUMN_ALIASES[col]);
    const finalColumns = selectedColumns.length > 0 ? selectedColumns : ['worker_name', 'request_type', 'status', 'start_date', 'end_date'];

    // Enforce role-based security
    const isAdminOrHR = user.roles?.includes('ADMIN') || user.roles?.includes('RRHH');
    let enforcedWorkerId = null;

    if (!isAdminOrHR) {
        // Find the worker ID of this user
        const workerRes = await query('SELECT id FROM workers WHERE user_id = $1 AND company_id = $2', [user.id, tenantId]);
        if (workerRes.rows.length === 0) {
            // Worker profile not found, return empty
            return {
                data: [],
                total: 0,
                previewLimit: limit,
                selectedColumns: finalColumns
            };
        }
        enforcedWorkerId = workerRes.rows[0].id;
    }

    let whereClauses = ['r.company_id = $1'];
    let params = [tenantId];
    let paramCount = 2;

    if (enforcedWorkerId) {
        whereClauses.push(`r.worker_id = $${paramCount++}`);
        params.push(enforcedWorkerId);
    } else if (workerId) {
        whereClauses.push(`r.worker_id = $${paramCount++}`);
        params.push(workerId);
    }

    if (dateFrom && moment(dateFrom).isValid()) {
        whereClauses.push(`r.start_date >= $${paramCount++}`);
        params.push(dateFrom);
    }
    if (dateTo && moment(dateTo).isValid()) {
        whereClauses.push(`r.end_date <= $${paramCount++}`);
        params.push(dateTo);
    }
    if (status) {
        whereClauses.push(`r.status = $${paramCount++}`);
        params.push(status);
    }
    if (requestType) {
        if (requestType.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)) {
            whereClauses.push(`r.request_type_id = $${paramCount++}`);
            params.push(requestType);
        } else {
            whereClauses.push(`rt.name ILIKE $${paramCount++}`);
            params.push(`%${requestType}%`);
        }
    }
    if (areaId) {
        if (areaId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)) {
            whereClauses.push(`COALESCE(w.area_id, jp.area_id) = $${paramCount++}`);
            params.push(areaId);
        } else {
            whereClauses.push(`a.name ILIKE $${paramCount++}`);
            params.push(`%${areaId}%`);
        }
    }

    const whereString = whereClauses.join(' AND ');

    const countSql = `
        SELECT COUNT(*)::int
        FROM employee_requests r
        LEFT JOIN workers w ON r.worker_id = w.id
        LEFT JOIN users u ON w.user_id = u.id
        LEFT JOIN request_types rt ON r.request_type_id = rt.id
        LEFT JOIN job_positions jp ON w.job_position_id = jp.id
        LEFT JOIN areas a ON a.id = COALESCE(w.area_id, jp.area_id)
        WHERE ${whereString}
    `;

    const dataSql = `
        SELECT r.id,
               r.start_date,
               r.end_date,
               r.days_requested,
               r.reason,
               r.status,
               r.created_at,
               CONCAT_WS(' ', u.first_name, u.last_name) AS worker_name,
               rt.name AS request_type,
               a.name AS department_name,
               jp.name AS job_title,
               CONCAT_WS(' ', ap.first_name, ap.last_name) AS approved_by
        FROM employee_requests r
        LEFT JOIN workers w ON r.worker_id = w.id
        LEFT JOIN users u ON w.user_id = u.id
        LEFT JOIN request_types rt ON r.request_type_id = rt.id
        LEFT JOIN job_positions jp ON w.job_position_id = jp.id
        LEFT JOIN areas a ON a.id = COALESCE(w.area_id, jp.area_id)
        LEFT JOIN users ap ON r.approved_by = ap.id
        WHERE ${whereString}
        ORDER BY r.created_at DESC
        LIMIT $${paramCount++} OFFSET $${paramCount++}
    `;

    const [countRes, dataRes] = await Promise.all([
        query(countSql, params),
        query(dataSql, [...params, limit, offset])
    ]);

    const total = countRes.rows[0]?.count || 0;

    const data = dataRes.rows.map(row => {
        const mappedRow = requestReportRowMapper(row);
        const filteredRow = {};
        
        finalColumns.forEach(col => {
            filteredRow[col] = mappedRow[col];
            
            // Reconstruct nested object structures if dot-notation key is requested
            if (col.includes('.')) {
                const parts = col.split('.');
                let current = filteredRow;
                for (let i = 0; i < parts.length - 1; i++) {
                    const part = parts[i];
                    if (!current[part]) {
                        current[part] = {};
                    }
                    current = current[part];
                }
                current[parts[parts.length - 1]] = mappedRow[col];
            }
        });

        // Always keep the id
        filteredRow.id = row.id;
        return filteredRow;
    });

    return {
        data,
        total,
        previewLimit: limit,
        selectedColumns: finalColumns
    };
  }

  async generateExcel(bodyOrData, tenantId, user) {
    let data, selectedColumns;
    if (bodyOrData && bodyOrData.rows && bodyOrData.columns) {
      data = bodyOrData.rows;
      selectedColumns = bodyOrData.columns;
    } else {
      const result = await this.getReportData(bodyOrData, tenantId, user, true);
      data = result.data;
      selectedColumns = result.selectedColumns;
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Reporte de Solicitudes');

    // Configure ExcelJS columns
    worksheet.columns = selectedColumns.map(col => {
      const baseCol = COLUMN_ALIASES[col] || col;
      return {
        header: ALLOWED_COLUMNS[baseCol]?.label || col,
        key: col,
        width: baseCol === 'reason' || baseCol === 'worker_name' ? 30 : 20
      };
    });

    // Add rows
    data.forEach(row => {
      worksheet.addRow(row);
    });

    // Header styling
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E3A8A' } // Sleek Dark Blue
    };

    worksheet.getRow(1).height = 24;

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
  }

  async generatePdf(bodyOrData, tenantId, user) {
    let data, selectedColumns;
    if (bodyOrData && bodyOrData.rows && bodyOrData.columns) {
      data = bodyOrData.rows;
      selectedColumns = bodyOrData.columns;
    } else {
      const result = await this.getReportData(bodyOrData, tenantId, user, true);
      data = result.data;
      selectedColumns = result.selectedColumns;
    }
    
    // Fetch company settings
    const company = await getCompanySettings(tenantId);
    if (!company) {
      throw new Error("La empresa no tiene configuración corporativa registrada");
    }

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 30, layout: 'landscape' });
        const buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => resolve(Buffer.concat(buffers)));

        // Report Title using company data
        const primaryColor = company.color_primario || '#1e3a8a';
        const textColor = company.color_texto || '#0f172a';
        
        if (company.nombre_comercial) {
            doc.fillColor(primaryColor).fontSize(16).text(company.nombre_comercial, { align: 'left' });
        }
        if (company.razon_social && company.ruc) {
            doc.fillColor(textColor).fontSize(10).text(`${company.razon_social} - RUC: ${company.ruc}`, { align: 'left' });
        }
        
        doc.moveDown(1);
        doc.fillColor(primaryColor).fontSize(22).text('Reporte Consolidado de Solicitudes', { align: 'center' });
        doc.fillColor(textColor).fontSize(10).text(`Generado el: ${new Date().toLocaleDateString()}`, { align: 'center' });
        doc.moveDown(2);

        // Table calculations
        const startX = 30;
        let startY = 100;
        const pageHeight = doc.page.height;
        const pageWidth = doc.page.width;
        const availableWidth = pageWidth - 60;
        const colWidth = availableWidth / selectedColumns.length;
        const headerColor = company.color_primario || '#1e3a8a';

        // Draw header
        doc.fillColor(headerColor).rect(startX, startY, availableWidth, 20).fill();
        doc.fillColor('#ffffff').fontSize(9);
        selectedColumns.forEach((col, index) => {
          const baseCol = COLUMN_ALIASES[col] || col;
          const colLabel = ALLOWED_COLUMNS[baseCol]?.label || col;
          doc.text(colLabel, startX + (index * colWidth) + 5, startY + 6, {
            width: colWidth - 10,
            ellipsis: true
          });
        });

        startY += 20;

        // Draw data rows
        doc.fillColor(textColor).fontSize(8);
        data.forEach((row, rowIndex) => {
          // Check page break
          if (startY > pageHeight - 50) {
            doc.addPage({ margin: 30, layout: 'landscape' });
            startY = 40;
            
            // Redraw header on new page
            doc.fillColor(headerColor).rect(startX, startY, availableWidth, 20).fill();
            doc.fillColor('#ffffff').fontSize(9);
            selectedColumns.forEach((col, index) => {
              const baseCol = COLUMN_ALIASES[col] || col;
              const colLabel = ALLOWED_COLUMNS[baseCol]?.label || col;
              doc.text(colLabel, startX + (index * colWidth) + 5, startY + 6, {
                width: colWidth - 10,
                ellipsis: true
              });
            });
            startY += 20;
            doc.fillColor('#000000').fontSize(8);
          }

          // Zebra striping
          if (rowIndex % 2 === 0) {
            doc.fillColor('#f3f4f6').rect(startX, startY, availableWidth, 18).fill();
          }

          doc.fillColor('#374151');
          selectedColumns.forEach((col, index) => {
            const val = row[col];
            let displayVal = 'N/A';
            if (val !== null && val !== undefined) {
              if (typeof val === 'object') {
                displayVal = val.fullName || val.name || JSON.stringify(val);
              } else {
                displayVal = String(val);
              }
            }
            doc.text(displayVal, startX + (index * colWidth) + 5, startY + 5, {
              width: colWidth - 10,
              height: 12,
              ellipsis: true
            });
          });

          startY += 18;
        });

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  async generateCsv(bodyOrData, tenantId, user) {
    let data, selectedColumns;
    if (bodyOrData && bodyOrData.rows && bodyOrData.columns) {
      data = bodyOrData.rows;
      selectedColumns = bodyOrData.columns;
    } else {
      const result = await this.getReportData(bodyOrData, tenantId, user, true);
      data = result.data;
      selectedColumns = result.selectedColumns;
    }

    // Build headers
    const headers = selectedColumns.map(col => {
      const baseCol = COLUMN_ALIASES[col] || col;
      return ALLOWED_COLUMNS[baseCol]?.label || col;
    });

    // Build rows
    const csvRows = [headers.join(',')];

    data.forEach(row => {
      const values = selectedColumns.map(col => {
        const val = row[col];
        let displayVal = 'N/A';
        if (val !== null && val !== undefined) {
          if (typeof val === 'object') {
            displayVal = val.fullName || val.name || JSON.stringify(val);
          } else {
            displayVal = String(val);
          }
        }
        // Escape quotes and wrap in quotes if contains commas, quotes, or newlines
        if (displayVal.includes(',') || displayVal.includes('"') || displayVal.includes('\n') || displayVal.includes('\r')) {
          displayVal = `"${displayVal.replace(/"/g, '""')}"`;
        }
        return displayVal;
      });
      csvRows.push(values.join(','));
    });

    return Buffer.from(csvRows.join('\n'), 'utf-8');
  }

  async getChartsData(body, tenantId, user) {
    const filters = body.filters || {};
    const { dateFrom, dateTo, status, requestType, workerId, areaId } = filters;
    const groupBy = body.groupBy || 'worker';
    const metric = body.metric || 'total_requests';
    const limit = Math.max(parseInt(body.limit, 10) || 10, 1);

    // Role security
    const isAdminOrHR = user.roles?.includes('ADMIN') || user.roles?.includes('RRHH');
    let enforcedWorkerId = null;

    if (!isAdminOrHR) {
        const workerRes = await query('SELECT id FROM workers WHERE user_id = $1 AND company_id = $2', [user.id, tenantId]);
        if (workerRes.rows.length === 0) {
            return { title: 'Sin datos', labels: [], datasets: [{ label: 'Sin datos', data: [] }], summary: { totalRequests: 0, topWorker: 'N/A', topValue: 0 } };
        }
        enforcedWorkerId = workerRes.rows[0].id;
    }

    let whereClauses = ['r.company_id = $1'];
    let params = [tenantId];
    let paramCount = 2;

    if (enforcedWorkerId) {
        whereClauses.push(`r.worker_id = $${paramCount++}`);
        params.push(enforcedWorkerId);
    } else if (workerId) {
        whereClauses.push(`r.worker_id = $${paramCount++}`);
        params.push(workerId);
    }

    if (dateFrom && moment(dateFrom).isValid()) {
        whereClauses.push(`r.start_date >= $${paramCount++}`);
        params.push(dateFrom);
    }
    if (dateTo && moment(dateTo).isValid()) {
        whereClauses.push(`r.end_date <= $${paramCount++}`);
        params.push(dateTo);
    }
    if (status) {
        whereClauses.push(`r.status = $${paramCount++}`);
        params.push(status);
    }
    if (requestType) {
        if (requestType.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)) {
            whereClauses.push(`r.request_type_id = $${paramCount++}`);
            params.push(requestType);
        } else {
            whereClauses.push(`rt.name ILIKE $${paramCount++}`);
            params.push(`%${requestType}%`);
        }
    }
    if (areaId) {
        if (areaId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)) {
            whereClauses.push(`COALESCE(w.area_id, jp.area_id) = $${paramCount++}`);
            params.push(areaId);
        } else {
            whereClauses.push(`a.name ILIKE $${paramCount++}`);
            params.push(`%${areaId}%`);
        }
    }

    const whereString = whereClauses.join(' AND ');

    // Aggregation select based on metric
    const aggSelect = metric === 'average_days' 
        ? 'ROUND(AVG(r.days_requested), 1)::float' 
        : 'COUNT(r.id)::int';

    let selectField = '';
    let groupByField = '';
    let orderByField = 'value DESC';
    let chartTitle = '';
    let datasetLabel = '';

    if (groupBy === 'worker') {
        selectField = `CONCAT_WS(' ', u.first_name, u.last_name)`;
        groupByField = 'u.first_name, u.last_name';
        chartTitle = metric === 'average_days' ? 'Promedio de días solicitados por trabajador' : 'Trabajadores con más solicitudes';
        datasetLabel = metric === 'average_days' ? 'Promedio de días' : 'Cantidad de solicitudes';
    } else if (groupBy === 'type') {
        selectField = 'rt.name';
        groupByField = 'rt.name';
        chartTitle = metric === 'average_days' ? 'Promedio de días solicitados por tipo' : 'Cantidad de solicitudes por tipo';
        datasetLabel = metric === 'average_days' ? 'Promedio de días' : 'Cantidad de solicitudes';
    } else if (groupBy === 'status') {
        selectField = 'r.status';
        groupByField = 'r.status';
        chartTitle = 'Solicitudes por estado';
        datasetLabel = 'Cantidad';
    } else if (groupBy === 'month') {
        selectField = `TO_CHAR(r.start_date, 'YYYY-MM')`;
        groupByField = `TO_CHAR(r.start_date, 'YYYY-MM')`;
        orderByField = 'label ASC';
        chartTitle = 'Solicitudes por mes';
        datasetLabel = 'Cantidad';
    } else if (groupBy === 'area') {
        selectField = 'a.name';
        groupByField = 'a.name';
        chartTitle = 'Solicitudes por departamento/área';
        datasetLabel = 'Cantidad';
    } else {
        throw new Error(`Tipo de agrupación no soportado: ${groupBy}`);
    }

    const sql = `
        SELECT ${selectField} AS label, ${aggSelect} AS value
        FROM employee_requests r
        LEFT JOIN workers w ON r.worker_id = w.id
        LEFT JOIN users u ON w.user_id = u.id
        LEFT JOIN request_types rt ON r.request_type_id = rt.id
        LEFT JOIN job_positions jp ON w.job_position_id = jp.id
        LEFT JOIN areas a ON a.id = COALESCE(w.area_id, jp.area_id)
        WHERE ${whereString}
        GROUP BY ${groupByField || selectField}
        ORDER BY ${orderByField}
        LIMIT $${paramCount}
    `;

    const result = await query(sql, [...params, limit]);

    const statusMap = {
        'pending': 'Pendiente',
        'approved': 'Aprobado',
        'rejected': 'Rechazado',
        'observed': 'Observado',
        'cancelled': 'Cancelado',
        'draft': 'Borrador'
    };

    const labels = [];
    const datasetData = [];
    let sumValues = 0;
    let topLabel = 'N/A';
    let topVal = 0;

    result.rows.forEach((row, i) => {
        let label = row.label || 'N/A';
        if (groupBy === 'status') {
            label = statusMap[label] || label;
        }
        labels.push(label);
        
        const val = row.value || 0;
        datasetData.push(val);
        
        sumValues += val;
        if (i === 0 || val > topVal) {
            topLabel = label;
            topVal = val;
        }
    });

    return {
        title: chartTitle,
        labels,
        datasets: [
            {
                label: datasetLabel,
                data: datasetData
            }
        ],
        summary: {
            totalRequests: sumValues,
            topWorker: topLabel,
            topValue: topVal
        }
    };
  }

  async getSummaryData(body, tenantId, user) {
    const filters = body.filters || body || {};
    const { dateFrom, dateTo, status, requestType, workerId, areaId } = filters;

    // Role security
    const isAdminOrHR = user.roles?.includes('ADMIN') || user.roles?.includes('RRHH');
    let enforcedWorkerId = null;

    if (!isAdminOrHR) {
        const workerRes = await query('SELECT id FROM workers WHERE user_id = $1 AND company_id = $2', [user.id, tenantId]);
        if (workerRes.rows.length === 0) {
            return { totalRequests: 0, approved: 0, pending: 0, rejected: 0, observed: 0, mostRequestedType: 'N/A', workerWithMostRequests: 'N/A' };
        }
        enforcedWorkerId = workerRes.rows[0].id;
    }

    let whereClauses = ['r.company_id = $1'];
    let params = [tenantId];
    let paramCount = 2;

    if (enforcedWorkerId) {
        whereClauses.push(`r.worker_id = $${paramCount++}`);
        params.push(enforcedWorkerId);
    } else if (workerId) {
        whereClauses.push(`r.worker_id = $${paramCount++}`);
        params.push(workerId);
    }

    if (dateFrom && moment(dateFrom).isValid()) {
        whereClauses.push(`r.start_date >= $${paramCount++}`);
        params.push(dateFrom);
    }
    if (dateTo && moment(dateTo).isValid()) {
        whereClauses.push(`r.end_date <= $${paramCount++}`);
        params.push(dateTo);
    }
    if (status) {
        whereClauses.push(`r.status = $${paramCount++}`);
        params.push(status);
    }
    if (requestType) {
        if (requestType.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)) {
            whereClauses.push(`r.request_type_id = $${paramCount++}`);
            params.push(requestType);
        } else {
            whereClauses.push(`rt.name ILIKE $${paramCount++}`);
            params.push(`%${requestType}%`);
        }
    }
    if (areaId) {
        if (areaId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)) {
            whereClauses.push(`COALESCE(w.area_id, jp.area_id) = $${paramCount++}`);
            params.push(areaId);
        } else {
            whereClauses.push(`a.name ILIKE $${paramCount++}`);
            params.push(`%${areaId}%`);
        }
    }

    const whereString = whereClauses.join(' AND ');

    // 1. Status count query
    const statusSql = `
        SELECT r.status, COUNT(*)::int AS count 
        FROM employee_requests r
        LEFT JOIN workers w ON r.worker_id = w.id
        LEFT JOIN users u ON w.user_id = u.id
        LEFT JOIN request_types rt ON r.request_type_id = rt.id
        LEFT JOIN job_positions jp ON w.job_position_id = jp.id
        LEFT JOIN areas a ON a.id = COALESCE(w.area_id, jp.area_id)
        WHERE ${whereString}
        GROUP BY r.status
    `;

    // 2. Most requested type query
    const typeSql = `
        SELECT rt.name AS type_name, COUNT(*)::int AS count
        FROM employee_requests r
        LEFT JOIN workers w ON r.worker_id = w.id
        LEFT JOIN users u ON w.user_id = u.id
        LEFT JOIN request_types rt ON r.request_type_id = rt.id
        LEFT JOIN job_positions jp ON w.job_position_id = jp.id
        LEFT JOIN areas a ON a.id = COALESCE(w.area_id, jp.area_id)
        WHERE ${whereString}
        GROUP BY rt.name
        ORDER BY count DESC
        LIMIT 1
    `;

    // 3. Worker with most requests query
    const workerSql = `
        SELECT CONCAT_WS(' ', u.first_name, u.last_name) AS worker_name, COUNT(*)::int AS count
        FROM employee_requests r
        LEFT JOIN workers w ON r.worker_id = w.id
        LEFT JOIN users u ON w.user_id = u.id
        LEFT JOIN request_types rt ON r.request_type_id = rt.id
        LEFT JOIN job_positions jp ON w.job_position_id = jp.id
        LEFT JOIN areas a ON a.id = COALESCE(w.area_id, jp.area_id)
        WHERE ${whereString}
        GROUP BY u.first_name, u.last_name
        ORDER BY count DESC
        LIMIT 1
    `;

    const [statusRes, typeRes, workerRes] = await Promise.all([
        query(statusSql, params),
        query(typeSql, params),
        query(workerSql, params)
    ]);

    let totalRequests = 0;
    let approved = 0;
    let pending = 0;
    let rejected = 0;
    let observed = 0;

    statusRes.rows.forEach(row => {
        const count = row.count || 0;
        totalRequests += count;
        if (row.status === 'approved') approved = count;
        if (row.status === 'pending') pending = count;
        if (row.status === 'rejected') rejected = count;
        if (row.status === 'observed') observed = count;
    });

    const mostRequestedType = typeRes.rows[0]?.type_name || 'N/A';
    const workerWithMostRequests = workerRes.rows[0]?.worker_name || 'N/A';

    return {
        totalRequests,
        approved,
        pending,
        rejected,
        observed,
        mostRequestedType,
        workerWithMostRequests
    };
  }
}

module.exports = new RequestReportService();
