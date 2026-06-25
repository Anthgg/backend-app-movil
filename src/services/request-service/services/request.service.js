const { query, withTransaction } = require('../../../config/database');
const moment = require('moment-timezone');
const vacationService = require('./vacation.service');
const { createNotification, createNotificationsForUsers, getCompanyNotificationRecipients } = require('../../../shared/utils/notifications');
const { normalizeRequestType } = require('../../../shared/services/attendance-day-status.service');
const { tableHasColumn } = require('../../../utils/db.util');
const { buildRequestCode } = require('./requestDocument.config');

const REQUEST_TIMEZONE = process.env.BUSINESS_TIMEZONE || process.env.TZ || 'America/Lima';

const REQUEST_STATUS_LABELS = Object.freeze({
  draft: 'Borrador',
  pending: 'Pendiente',
  pending_supervisor: 'Pendiente supervisor',
  pending_rrhh: 'Pendiente RRHH',
  observed: 'Observada',
  approved: 'Aprobada',
  rejected: 'Rechazada',
  cancelled: 'Cancelada',
  expired: 'Expirada'
});
const REQUEST_STATUS_ALIASES = Object.freeze({
  draft: 'draft',
  borrador: 'draft',
  pending: 'pending',
  pendiente: 'pending',
  pending_supervisor: 'pending_supervisor',
  pendiente_supervisor: 'pending_supervisor',
  supervisor: 'pending_supervisor',
  pending_rrhh: 'pending_rrhh',
  pendiente_rrhh: 'pending_rrhh',
  rrhh: 'pending_rrhh',
  observed: 'observed',
  observada: 'observed',
  observado: 'observed',
  approved: 'approved',
  aprobada: 'approved',
  aprobado: 'approved',
  rejected: 'rejected',
  rechazada: 'rejected',
  rechazado: 'rejected',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  cancelada: 'cancelled',
  cancelado: 'cancelled',
  expired: 'expired',
  expirada: 'expired',
  expirado: 'expired'
});

function normalizeRequestStatus(value) {
  if (value === undefined || value === null || value === '') return null;

  const token = String(value)
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[-\s]+/g, '_')
    .toLowerCase();

  return REQUEST_STATUS_ALIASES[token] || null;
}

function normalizeRequestStatuses(value) {
  if (!value) return [];
  const rawValues = Array.isArray(value) ? value : String(value).split(',');
  return [...new Set(rawValues
    .map((item) => normalizeRequestStatus(item) || String(item || '').trim().toLowerCase())
    .filter(Boolean))];
}

function buildRequestStatusFields(value) {
  const statusKey = normalizeRequestStatus(value) || String(value || 'pending').trim().toLowerCase();
  const statusLabel = REQUEST_STATUS_LABELS[statusKey] || statusKey;

  return {
    status: statusKey,
    statusKey,
    status_key: statusKey,
    statusLabel,
    status_label: statusLabel
  };
}

function formatRequestDate(value) {
  if (!value) return null;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const dateMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) return dateMatch[1];
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const parsed = moment(value);
  return parsed.isValid() ? parsed.toISOString().slice(0, 10) : null;
}

function buildRequestDateFields(prefix, value, timezone = REQUEST_TIMEZONE) {
  const date = formatRequestDate(value);
  const localNoon = date ? moment.tz(`${date} 12:00:00`, 'YYYY-MM-DD HH:mm:ss', timezone) : null;
  const dateTime = localNoon ? localNoon.format() : null;
  const displayDate = localNoon ? localNoon.format('DD/MM/YYYY') : null;

  return {
    [`${prefix}Date`]: date,
    [`${prefix}_date`]: date,
    [`${prefix}DateKey`]: date,
    [`${prefix}_date_key`]: date,
    [`${prefix}LocalDate`]: date,
    [`${prefix}_local_date`]: date,
    [`${prefix}CalendarDate`]: date,
    [`${prefix}_calendar_date`]: date,
    [`${prefix}CalendarDateTime`]: dateTime,
    [`${prefix}_calendar_date_time`]: dateTime,
    [`${prefix}DisplayDate`]: displayDate,
    [`${prefix}_display_date`]: displayDate
  };
}

class RequestService {
  async hasEmployeeRequestMetadataColumn() {
    const result = await query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'employee_requests'
         AND column_name = 'metadata'
       LIMIT 1`
    );

    return result.rows.length > 0;
  }

  async hasEmployeeRequestTrackingColumns(db = { query }) {
    const [hasSequence, hasCode] = await Promise.all([
      tableHasColumn('employee_requests', 'request_sequence', db),
      tableHasColumn('employee_requests', 'request_code', db)
    ]);

    return hasSequence && hasCode;
  }

  async assignRequestTrackingCode(id, requestType, db = { query }) {
    try {
      if (!(await this.hasEmployeeRequestTrackingColumns(db))) {
        return {};
      }

      const existing = await db.query(
        'SELECT request_sequence, request_code FROM employee_requests WHERE id = $1 LIMIT 1',
        [id]
      );
      if (existing.rows[0]?.request_code) {
        return {
          request_sequence: existing.rows[0].request_sequence,
          request_code: existing.rows[0].request_code
        };
      }

      const sequenceResult = await db.query(
        "SELECT nextval('public.employee_request_code_seq') AS sequence_number"
      );
      const sequenceNumber = sequenceResult.rows[0].sequence_number;
      const requestCode = buildRequestCode(sequenceNumber, requestType?.code, requestType?.name);

      const updated = await db.query(`
        UPDATE employee_requests
        SET request_sequence = $1,
            request_code = $2,
            updated_at = NOW()
        WHERE id = $3
          AND request_code IS NULL
        RETURNING request_sequence, request_code
      `, [sequenceNumber, requestCode, id]);

      return updated.rows[0] || {
        request_sequence: sequenceNumber,
        request_code: requestCode
      };
    } catch (error) {
      if (['42P01', '42703'].includes(error.code)) {
        return {};
      }
      throw error;
    }
  }

  serializeRequest(row) {
    if (!row) {
      return null;
    }

    const statusFields = buildRequestStatusFields(row.status);
    const startDateFields = buildRequestDateFields('start', row.start_date || row.startDate);
    const endDateFields = buildRequestDateFields('end', row.end_date || row.endDate);

    return {
      id: row.id,
      requestCode: row.request_code || row.requestCode || null,
      request_code: row.request_code || row.requestCode || null,
      requestTypeId: row.request_type_id,
      request_type_id: row.request_type_id,
      type: normalizeRequestType(row.type_code, row.type_name),
      ...statusFields,
      ...startDateFields,
      ...endDateFields,
      timezone: REQUEST_TIMEZONE,
      dateTimezone: REQUEST_TIMEZONE,
      date_timezone: REQUEST_TIMEZONE,
      reason: row.reason,
      metadata: row.metadata || {},
      vacationBalance: row.metadata?.vacationBalance || null,
      requiresBalanceOverride: row.metadata?.vacationBalance?.requiresManagerOverride === true
    };
  }

  normalizeRequestStatus(value) {
    return normalizeRequestStatus(value);
  }

  buildRequestStatusFields(value) {
    return buildRequestStatusFields(value);
  }

  enrichRequestRow(row) {
    const type = normalizeRequestType(row.type_code, row.type_name);
    const startDateFields = buildRequestDateFields('start', row.start_date || row.startDate);
    const endDateFields = buildRequestDateFields('end', row.end_date || row.endDate);

    return {
      ...row,
      ...buildRequestStatusFields(row.status),
      ...startDateFields,
      ...endDateFields,
      type,
      timezone: row.timezone || REQUEST_TIMEZONE,
      dateTimezone: REQUEST_TIMEZONE,
      date_timezone: REQUEST_TIMEZONE,
      requestCode: row.request_code || row.requestCode || null,
      request_code: row.request_code || row.requestCode || null
    };
  }

  async getActiveRequestTypes(tenantId) {
    const result = await query(`
      SELECT id, name, code
      FROM request_types
      WHERE is_active = true
        AND (company_id = $1 OR company_id IS NULL)
      ORDER BY
        CASE WHEN company_id = $1 THEN 0 ELSE 1 END,
        name ASC
    `, [tenantId]);

    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      code: normalizeRequestType(row.code, row.name) || row.code,
      type: normalizeRequestType(row.code, row.name) || row.code
    }));
  }

  async createRequest(data) {
    let { workerId, tenantId, request_type_id, type, start_date, end_date, reason, document_urls, metadata } = data;

    // Resolver request_type_id si se envía el nombre o código
    if (!request_type_id && type) {
        const typeRes = await query(
            'SELECT id FROM request_types WHERE (UPPER(name) = UPPER($1) OR UPPER(code) = UPPER($1)) AND (company_id = $2 OR company_id IS NULL)',
            [type, tenantId]
        );
        if (typeRes.rows.length > 0) {
            request_type_id = typeRes.rows[0].id;
        } else {
            throw new Error(`Tipo de solicitud '${type}' no reconocido.`);
        }
    }

    if (!request_type_id) {
        const err = new Error('El tipo de solicitud es obligatorio.');
        err.statusCode = 400;
        err.errorCode = 'VALIDATION_ERROR';
        throw err;
    }

    const requestTypeRes = await query(
        `SELECT id, name, code
         FROM request_types
         WHERE id = $1
           AND is_active = true
           AND (company_id = $2 OR company_id IS NULL)`,
        [request_type_id, tenantId]
    );

    if (requestTypeRes.rows.length === 0) {
        const err = new Error('Tipo de solicitud no valido.');
        err.statusCode = 422;
        err.errorCode = 'INVALID_REQUEST_TYPE';
        throw err;
    }

    const startDate = moment(start_date);
    const endDate = moment(end_date);

    if (!startDate.isValid() || !endDate.isValid()) {
        const err = new Error('Rango de fechas invalido.');
        err.statusCode = 400;
        err.errorCode = 'INVALID_DATE_RANGE';
        throw err;
    }

    // Validar fecha de ingreso
    const workerRes = await query('SELECT hire_date FROM workers WHERE id = $1 AND company_id = $2', [workerId, tenantId]);
    if (workerRes.rows.length > 0) {
        const hireDate = moment(workerRes.rows[0].hire_date);
        if (startDate.isBefore(hireDate, 'day')) {
            const err = new Error(`No puedes realizar solicitudes para fechas anteriores a tu ingreso (${workerRes.rows[0].hire_date}).`);
            err.statusCode = 400;
            throw err;
        }
    }

    if (endDate.isBefore(startDate)) {
        const err = new Error('Rango de fechas invalido.');
        err.statusCode = 400;
        err.errorCode = 'INVALID_DATE_RANGE';
        throw err;
    }
    const days_requested = endDate.diff(startDate, 'days') + 1;

    // Validar si es de tipo vacaciones y si hay saldo
    const canonicalRequestType = normalizeRequestType(
      requestTypeRes.rows[0]?.code,
      requestTypeRes.rows[0]?.name
    );
    const isVacation = canonicalRequestType === 'VACATION';
    
    const vacationAssessment = isVacation
      ? await vacationService.assessVacationRequest(workerId, tenantId, days_requested)
      : null;
    const requestMetadata = {
      ...(metadata && typeof metadata === 'object' ? metadata : {}),
      ...(vacationAssessment ? { vacationBalance: vacationAssessment } : {})
    };

    // Validar superposición
    const overlap = await query(`
      SELECT id FROM employee_requests 
      WHERE worker_id = $1
        AND LOWER(status) IN ('pending', 'pending_supervisor', 'pending_rrhh', 'observed', 'approved')
      AND (start_date, end_date) OVERLAPS ($2, $3)
    `, [workerId, start_date, end_date]);
    
    if (overlap.rows.length > 0) {
        const err = new Error('Ya existe una solicitud pendiente o aprobada en estas fechas.');
        err.statusCode = 409;
        throw err;
    }

    const supportsMetadata = await this.hasEmployeeRequestMetadataColumn();

    const requestRecord = await withTransaction(async (db) => {
      const insertColumns = [
        'company_id',
        'worker_id',
        'request_type_id',
        'start_date',
        'end_date',
        'days_requested',
        'reason'
      ];
      const insertValues = [
        tenantId,
        workerId,
        request_type_id,
        start_date,
        end_date,
        days_requested,
        reason
      ];
      const placeholders = insertValues.map((_, index) => `$${index + 1}`);

      if (supportsMetadata) {
        insertColumns.push('metadata');
        insertValues.push(JSON.stringify(requestMetadata));
        placeholders.push(`$${insertValues.length}::jsonb`);
      }

      const result = await db.query(`
        INSERT INTO employee_requests (${insertColumns.join(', ')})
        VALUES (${placeholders.join(', ')}) RETURNING *
      `, insertValues);

      const createdRequest = result.rows[0];
      const tracking = await this.assignRequestTrackingCode(
        createdRequest.id,
        requestTypeRes.rows[0],
        db
      );
      Object.assign(createdRequest, tracking);

      if (document_urls && document_urls.length > 0) {
        for (const doc of document_urls) {
          const fileUrl = typeof doc === 'string' ? doc : doc.url;
          const mimeType = typeof doc === 'object' ? doc.mimeType || null : null;
          const fileSize = typeof doc === 'object' ? doc.size || null : null;
          await db.query(
            `INSERT INTO request_documents (company_id, request_id, file_url, mime_type, file_size, uploaded_by)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [tenantId, createdRequest.id, fileUrl, mimeType, fileSize, workerId]
          );
        }
      }

      if (isVacation && typeof vacationService.updateVacationLedger === 'function') {
        await vacationService.updateVacationLedger(workerId, tenantId, 'debit', days_requested, `Solicitud #${createdRequest.id}`);
      }

      return createdRequest;
    });

    const recipients = await getCompanyNotificationRecipients(tenantId);
    await createNotificationsForUsers(
      recipients,
      tenantId,
      'Nueva solicitud',
      `Se creó una nueva solicitud con motivo: ${reason}`,
      'request_created'
    );

    return requestRecord;
  }

  async getRequests(filters, tenantId) {
    const pageNumber = Math.max(parseInt(filters.page, 10) || 1, 1);
    const limitNumber = Math.max(parseInt(filters.limit, 10) || 10, 1);
    const { 
      workerId, 
      worker_id,
      status,
      statuses,
      status_in,
      requestTypeId, 
      request_type_id, 
      startDate, 
      start_date, 
      endDate, 
      end_date,
      search,
      worker_name,
      departmentId,
      department_id,
      area
    } = filters;
    const offset = (pageNumber - 1) * limitNumber;

    let whereClauses = ['r.company_id = $1'];
    let params = [tenantId];
    let paramCount = 2;

    const actualWorkerId = workerId || worker_id;
    if (actualWorkerId) {
        whereClauses.push(`r.worker_id = $${paramCount++}`);
        params.push(actualWorkerId);
    }
    const requestedStatuses = normalizeRequestStatuses(status || statuses || status_in);
    if (requestedStatuses.length > 0) {
        whereClauses.push(`LOWER(r.status) = ANY($${paramCount++}::text[])`);
        params.push(requestedStatuses);
    }
    const actualRequestTypeId = requestTypeId || request_type_id;
    if (actualRequestTypeId) {
        whereClauses.push(`r.request_type_id = $${paramCount++}`);
        params.push(actualRequestTypeId);
    }
    const actualStartDate = startDate || start_date;
    if (actualStartDate) {
        whereClauses.push(`r.start_date >= $${paramCount++}`);
        params.push(actualStartDate);
    }
    const actualEndDate = endDate || end_date;
    if (actualEndDate) {
        whereClauses.push(`r.end_date <= $${paramCount++}`);
        params.push(actualEndDate);
    }
    const actualSearch = search || worker_name;
    if (actualSearch) {
        whereClauses.push(`(u.first_name ILIKE $${paramCount} OR u.last_name ILIKE $${paramCount})`);
        params.push(`%${actualSearch}%`);
        paramCount++;
    }
    const actualDeptId = departmentId || department_id || area;
    if (actualDeptId) {
        // Si es un UUID (ID de departamento)
        if (actualDeptId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)) {
            whereClauses.push(`COALESCE(w.area_id, jp.area_id) = $${paramCount++}`);
            params.push(actualDeptId);
        } else {
            // Si es un string normal (nombre del departamento)
            whereClauses.push(`a.name ILIKE $${paramCount++}`);
            params.push(`%${actualDeptId}%`);
        }
    }
    
    const whereString = whereClauses.join(' AND ');

    const dataQuery = `
        SELECT r.*,
               CONCAT_WS(' ', u.first_name, u.last_name) AS worker_name,
               rt.name AS type_name,
               rt.code AS type_code,
               a.name AS department_name,
               jp.name AS job_title
        FROM employee_requests r
        LEFT JOIN workers w ON r.worker_id = w.id
        LEFT JOIN users u ON w.user_id = u.id
        LEFT JOIN request_types rt ON r.request_type_id = rt.id
        LEFT JOIN job_positions jp ON w.job_position_id = jp.id
        LEFT JOIN areas a ON a.id = COALESCE(w.area_id, jp.area_id)
        WHERE ${whereString} 
        ORDER BY r.created_at DESC 
        LIMIT $${paramCount++} OFFSET $${paramCount++}`;
        
    const countQuery = `
        SELECT COUNT(*) 
        FROM employee_requests r 
        LEFT JOIN workers w ON r.worker_id = w.id
        LEFT JOIN users u ON w.user_id = u.id
        LEFT JOIN job_positions jp ON w.job_position_id = jp.id
        LEFT JOIN areas a ON a.id = COALESCE(w.area_id, jp.area_id)
        WHERE ${whereString}`;

    const dataPromise = query(dataQuery, [...params, limitNumber, offset]);
    const countPromise = query(countQuery, params);

    const [dataRes, countRes] = await Promise.all([dataPromise, countPromise]);
    const total = parseInt(countRes.rows[0].count, 10);

    return {
        data: dataRes.rows.map((row) => this.enrichRequestRow(row)),
        pagination: { total, page: pageNumber, limit: limitNumber, totalPages: Math.ceil(total / limitNumber) }
    };
  }

  async getRequestById(id, tenantId) {
    const result = await query(`
        SELECT r.*,
               CONCAT_WS(' ', u.first_name, u.last_name) AS worker_name,
               rt.name AS type_name,
               rt.code AS type_code
        FROM employee_requests r
        LEFT JOIN workers w ON r.worker_id = w.id
        LEFT JOIN users u ON w.user_id = u.id
        LEFT JOIN request_types rt ON r.request_type_id = rt.id
        WHERE r.id = $1 AND r.company_id = $2
    `, [id, tenantId]);
    if (result.rows.length === 0) {
        const err = new Error('Solicitud no encontrada.');
        err.statusCode = 404;
        throw err;
    }

    // Incluir documentos adjuntos
    const docsResult = await query(`
        SELECT id, request_id, document_type, file_url, file_path, mime_type, file_size, status, observation, created_at
        FROM request_documents
        WHERE request_id = $1 AND company_id = $2
        ORDER BY created_at ASC
    `, [id, tenantId]);

    const request = result.rows[0];
    Object.assign(request, this.enrichRequestRow(request));
    
    request.documents = docsResult.rows.map(doc => ({
        id: doc.id,
        requestId: doc.request_id,
        name: doc.document_type || 'documento',
        fileName: doc.document_type || 'documento',
        documentType: doc.document_type || 'documento',
        document_type: doc.document_type || 'documento',
        status: doc.status || 'pending',
        observation: doc.observation || null,
        file_url: doc.file_url,
        fileUrl: doc.file_url,
        file_path: doc.file_path || null,
        filePath: doc.file_path || null,
        mime_type: doc.mime_type || 'application/octet-stream',
        mimeType: doc.mime_type || 'application/octet-stream',
        size: doc.file_size || 0,
        createdAt: doc.created_at
    }));
    
    // Alias para compatibilidad web/mobile
    request.attachments = request.documents;

    return request;
  }

  async attachRequestDocuments(requests, tenantId) {
    if (!requests || requests.length === 0) return requests;

    const requestIds = requests.map(r => r.id);

    // Fetch all documents for these requests avoiding N+1
    const docsResult = await query(`
      SELECT 
        id, 
        request_id,
        document_type,
        file_url,
        file_path,
        mime_type,
        file_size,
        status, 
        observation, 
        created_at
      FROM request_documents
      WHERE request_id = ANY($1) AND company_id = $2
      ORDER BY created_at ASC
    `, [requestIds, tenantId]);

    const docsByRequestId = {};
    docsResult.rows.forEach(doc => {
      // Normalizar estructura según los requerimientos del frontend
      const normalizedDoc = {
        id: doc.id,
        requestId: doc.request_id,
        name: doc.document_type || 'documento',
        fileName: doc.document_type || 'documento',
        documentType: doc.document_type || 'documento',
        document_type: doc.document_type || 'documento',
        status: doc.status || 'pending',
        observation: doc.observation || null,
        file_url: doc.file_url,
        fileUrl: doc.file_url,
        file_path: doc.file_path || null,
        filePath: doc.file_path || null,
        mime_type: doc.mime_type || 'application/octet-stream',
        mimeType: doc.mime_type || 'application/octet-stream',
        size: doc.file_size || 0,
        createdAt: doc.created_at
      };

      if (!docsByRequestId[doc.request_id]) {
        docsByRequestId[doc.request_id] = [];
      }
      docsByRequestId[doc.request_id].push(normalizedDoc);
    });

    return requests.map(req => {
      const docs = docsByRequestId[req.id] || [];
      return {
        ...req,
        documents: docs,
        attachments: docs
      };
    });
  }

  async #updateStatus(id, tenantId, newStatus, processorId, comment) {
    const reqRes = await query('SELECT * FROM employee_requests WHERE id = $1 AND company_id = $2', [id, tenantId]);
    if (reqRes.rows.length === 0) {
        const err = new Error('Solicitud no encontrada.');
        err.statusCode = 404;
        throw err;
    }
    const reqData = reqRes.rows[0];

    // Validar transiciones permitidas
    if (newStatus === 'cancelled' && reqData.status !== 'pending') {
        throw new Error('Solo puedes cancelar solicitudes pendientes.');
    }
    
    if (['approved', 'rejected', 'observed'].includes(newStatus) && reqData.status !== 'pending' && reqData.status !== 'observed') {
        throw new Error(`La solicitud ya está en estado ${reqData.status}.`);
    }

    const result = await query(
        `UPDATE employee_requests 
         SET status = $1, approved_by = $2, hr_comment = $3, approved_at = NOW(), updated_at = NOW() 
         WHERE id = $4 RETURNING *`, 
        [newStatus, processorId, comment, id]
    );

    // Enviar notificación al trabajador
    const workerUserRes = await query('SELECT user_id FROM workers WHERE id = $1', [reqData.worker_id]);
    if (workerUserRes.rows.length > 0) {
        const targetUserId = workerUserRes.rows[0].user_id;
        const statusMap = {
            'approved': { title: 'Solicitud Aprobada', type: 'request_approved' },
            'rejected': { title: 'Solicitud Rechazada', type: 'request_rejected' },
            'observed': { title: 'Solicitud Observada', type: 'request_observed' }
        };

        if (statusMap[newStatus]) {
            await createNotification(
                targetUserId, 
                tenantId, 
                statusMap[newStatus].title, 
                `Tu solicitud ha sido ${newStatus === 'approved' ? 'aprobada' : (newStatus === 'rejected' ? 'rechazada' : 'observada')}. Comentario: ${comment || 'N/A'}`,
                statusMap[newStatus].type
            );
        }
    }

    return result.rows[0];
  }

  approveRequest(id, tenantId, approverId, comment) {
      return this.#updateStatus(id, tenantId, 'approved', approverId, comment || 'Aprobado');
  }
  
  rejectRequest(id, tenantId, approverId, comment) {
      if (!comment) throw new Error('El motivo del rechazo es obligatorio.');
      return this.#updateStatus(id, tenantId, 'rejected', approverId, comment);
  }

  observeRequest(id, tenantId, approverId, comment) {
      if (!comment) throw new Error('El comentario de observación es obligatorio.');
      return this.#updateStatus(id, tenantId, 'observed', approverId, comment);
  }

  async cancelRequest(id, workerId, userId, tenantId) {
    const reqRes = await query(
      'SELECT * FROM employee_requests WHERE id = $1 AND company_id = $2',
      [id, tenantId]
    );

    if (reqRes.rows.length === 0) {
        const err = new Error('Solicitud no existe.');
        err.statusCode = 404;
        err.errorCode = 'REQUEST_NOT_FOUND';
        throw err;
    }

    const currentRequest = reqRes.rows[0];

    if (currentRequest.worker_id !== workerId) {
        const err = new Error('La solicitud no pertenece al trabajador autenticado.');
        err.statusCode = 403;
        err.errorCode = 'REQUEST_FORBIDDEN';
        throw err;
    }
    
    if (currentRequest.status !== 'pending') {
        const err = new Error('La solicitud no esta pendiente y no puede cancelarse.');
        err.statusCode = 422;
        err.errorCode = 'REQUEST_NOT_PENDING';
        throw err;
    }

    const result = await query(
      `UPDATE employee_requests
       SET status = 'cancelled',
           hr_comment = COALESCE(hr_comment, 'Cancelado por el usuario.'),
           updated_at = NOW(),
           deleted_by = COALESCE(deleted_by, $2)
       WHERE id = $1
       RETURNING *`,
      [id, userId]
    );

    const workerUserRes = await query('SELECT user_id FROM workers WHERE id = $1', [workerId]);
    if (workerUserRes.rows[0]?.user_id) {
      await createNotification(
        workerUserRes.rows[0].user_id,
        tenantId,
        'Solicitud cancelada',
        'Tu solicitud fue cancelada correctamente.',
        'request_cancelled'
      );
    }

    return result.rows[0];
  }

  async resubmitRequest(id, workerId, tenantId, newData) {
    const reqRes = await query('SELECT * FROM employee_requests WHERE id = $1 AND company_id = $2 AND worker_id = $3', [id, tenantId, workerId]);
    if (reqRes.rows.length === 0) throw new Error('Solicitud no encontrada.');
    if (reqRes.rows[0].status !== 'observed') throw new Error('Solo se pueden reenviar solicitudes observadas.');

    // Actualizar datos y volver a pending
    const { reason, start_date, end_date } = newData;
    const result = await query(
        `UPDATE employee_requests 
         SET status = 'pending', reason = COALESCE($1, reason), start_date = COALESCE($2, start_date), end_date = COALESCE($3, end_date), updated_at = NOW()
         WHERE id = $4 RETURNING *`,
        [reason, start_date, end_date, id]
    );
    return result.rows[0];
  }

  async updateRequest(id, workerId, tenantId, data) {
    const { start_date, end_date, reason, request_type_id } = data;

    const reqRes = await query('SELECT * FROM employee_requests WHERE id = $1 AND company_id = $2 AND worker_id = $3', [id, tenantId, workerId]);
    if (reqRes.rows.length === 0) {
      const err = new Error('Solicitud no encontrada o no te pertenece.');
      err.statusCode = 404;
      throw err;
    }

    const currentReq = reqRes.rows[0];
    const allowedStatuses = ['pending', 'observed', 'draft'];
    if (!allowedStatuses.includes(currentReq.status)) {
      const err = new Error(`No puedes editar una solicitud en estado ${currentReq.status}.`);
      err.statusCode = 403;
      throw err;
    }

    let finalStartDate = start_date || currentReq.start_date;
    let finalEndDate = end_date || currentReq.end_date;
    let days_requested = currentReq.days_requested;

    if (start_date || end_date) {
      const mStart = moment(finalStartDate);
      const mEnd = moment(finalEndDate);
      if (mEnd.isBefore(mStart)) {
        throw new Error('La fecha de fin no puede ser anterior a la de inicio.');
      }
      days_requested = mEnd.diff(mStart, 'days') + 1;

      // Validar superposición (excluyendo la misma solicitud)
      const overlap = await query(`
        SELECT id FROM employee_requests 
        WHERE worker_id = $1
          AND LOWER(status) IN ('pending', 'pending_supervisor', 'pending_rrhh', 'observed', 'approved')
        AND id != $2
        AND (start_date, end_date) OVERLAPS ($3, $4)
      `, [workerId, id, finalStartDate, finalEndDate]);
      
      if (overlap.rows.length > 0) {
        const err = new Error('Las nuevas fechas se superponen con otra solicitud existente.');
        err.statusCode = 409;
        throw err;
      }
    }

    const result = await query(
      `UPDATE employee_requests 
       SET start_date = $1, end_date = $2, days_requested = $3, reason = COALESCE($4, reason), request_type_id = COALESCE($5, request_type_id), updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [finalStartDate, finalEndDate, days_requested, reason, request_type_id, id]
    );

    return result.rows[0];
  }
}

module.exports = new RequestService();
