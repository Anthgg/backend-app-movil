const { query } = require('../../../config/database');
const moment = require('moment');
const vacationService = require('./vacation.service');
const { createNotification } = require('../../../shared/utils/notifications');

class RequestService {
  async getActiveRequestTypes(tenantId) {
    const result = await query(`
      SELECT id, name
      FROM request_types
      WHERE is_active = true
        AND (company_id = $1 OR company_id IS NULL)
      ORDER BY
        CASE WHEN company_id = $1 THEN 0 ELSE 1 END,
        name ASC
    `, [tenantId]);

    return result.rows.map((row) => ({
      id: row.id,
      name: row.name
    }));
  }

  async createRequest(data) {
    let { workerId, tenantId, request_type_id, type, start_date, end_date, reason, document_urls } = data;

    // Resolver request_type_id si se envía el nombre o código
    if (!request_type_id && type) {
        const typeRes = await query(
            'SELECT id FROM request_types WHERE (name = $1 OR code = $1) AND (company_id = $2 OR company_id IS NULL)', 
            [type, tenantId]
        );
        if (typeRes.rows.length > 0) {
            request_type_id = typeRes.rows[0].id;
        } else {
            throw new Error(`Tipo de solicitud '${type}' no reconocido.`);
        }
    }

    if (!request_type_id) throw new Error('El tipo de solicitud es obligatorio.');

    const startDate = moment(start_date);
    const endDate = moment(end_date);

    // Validar fecha de ingreso
    const workerRes = await query('SELECT hire_date FROM workers WHERE id = $1', [workerId]);
    if (workerRes.rows.length > 0) {
        const hireDate = moment(workerRes.rows[0].hire_date);
        if (startDate.isBefore(hireDate, 'day')) {
            const err = new Error(`No puedes realizar solicitudes para fechas anteriores a tu ingreso (${workerRes.rows[0].hire_date}).`);
            err.statusCode = 400;
            throw err;
        }
    }

    if (endDate.isBefore(startDate)) {
        const err = new Error('La fecha de fin no puede ser anterior a la fecha de inicio.');
        err.statusCode = 400;
        throw err;
    }
    const days_requested = endDate.diff(startDate, 'days') + 1;

    // Validar si es de tipo vacaciones y si hay saldo
    const typeRes = await query('SELECT name FROM request_types WHERE id = $1', [request_type_id]);
    const isVacation = typeRes.rows[0]?.name.toLowerCase().includes('vacaciones');
    
    if (isVacation) {
        await vacationService.checkVacationBalance(workerId, tenantId, days_requested);
    }

    // Validar superposición
    const overlap = await query(`
      SELECT id FROM employee_requests 
      WHERE worker_id = $1 AND status IN ('pending', 'approved') 
      AND (start_date, end_date) OVERLAPS ($2, $3)
    `, [workerId, start_date, end_date]);
    
    if (overlap.rows.length > 0) {
        const err = new Error('Ya existe una solicitud pendiente o aprobada en estas fechas.');
        err.statusCode = 409;
        throw err;
    }

    await query('BEGIN');

    const result = await query(`
      INSERT INTO employee_requests (company_id, worker_id, request_type_id, start_date, end_date, days_requested, reason)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
    `, [tenantId, workerId, request_type_id, start_date, end_date, days_requested, reason]);
    
    const requestRecord = result.rows[0];

    if (document_urls && document_urls.length > 0) {
      for (const url of document_urls) {
        await query(`INSERT INTO request_documents (request_id, document_url) VALUES ($1, $2)`, [requestRecord.id, url]);
      }
    }

    if (isVacation) {
        await vacationService.updateVacationLedger(workerId, tenantId, 'debit', days_requested, `Solicitud #${requestRecord.id}`);
    }

    await query('COMMIT');
    return requestRecord;
  }

  async getRequests(filters, tenantId) {
    const pageNumber = Math.max(parseInt(filters.page, 10) || 1, 1);
    const limitNumber = Math.max(parseInt(filters.limit, 10) || 10, 1);
    const { workerId, status } = filters;
    const offset = (pageNumber - 1) * limitNumber;

    let whereClauses = ['r.company_id = $1'];
    let params = [tenantId];
    let paramCount = 2;

    if (workerId) {
        whereClauses.push(`r.worker_id = $${paramCount++}`);
        params.push(workerId);
    }
    if (status) {
        whereClauses.push(`r.status = $${paramCount++}`);
        params.push(status);
    }
    
    const whereString = whereClauses.join(' AND ');

    const dataQuery = `
        SELECT r.*,
               CONCAT_WS(' ', u.first_name, u.last_name) AS worker_name,
               rt.name AS type_name
        FROM employee_requests r
        LEFT JOIN workers w ON r.worker_id = w.id
        LEFT JOIN users u ON w.user_id = u.id
        LEFT JOIN request_types rt ON r.request_type_id = rt.id
        WHERE ${whereString} 
        ORDER BY r.created_at DESC 
        LIMIT $${paramCount++} OFFSET $${paramCount++}`;
    const countQuery = `SELECT COUNT(*) FROM employee_requests r WHERE ${whereString}`;

    const dataPromise = query(dataQuery, [...params, limitNumber, offset]);
    const countPromise = query(countQuery, params);

    const [dataRes, countRes] = await Promise.all([dataPromise, countPromise]);
    const total = parseInt(countRes.rows[0].count, 10);

    return {
        data: dataRes.rows,
        pagination: { total, page: pageNumber, limit: limitNumber, totalPages: Math.ceil(total / limitNumber) }
    };
  }

  async getRequestById(id, tenantId) {
    const result = await query(`
        SELECT r.*,
               CONCAT_WS(' ', u.first_name, u.last_name) AS worker_name,
               rt.name AS type_name
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
    return result.rows[0];
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

  async cancelRequest(id, workerId, tenantId) {
    const reqRes = await query('SELECT * FROM employee_requests WHERE id = $1 AND company_id = $2 AND worker_id = $3', [id, tenantId, workerId]);
    if (reqRes.rows.length === 0) {
        const err = new Error('Solicitud no encontrada o no te pertenece.');
        err.statusCode = 404;
        throw err;
    }
    
    if (reqRes.rows[0].status !== 'pending') {
        const err = new Error('Solo puedes cancelar solicitudes pendientes.');
        err.statusCode = 403;
        throw err;
    }

    return this.#updateStatus(id, tenantId, 'cancelled', workerId, 'Cancelado por el usuario.');
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
        WHERE worker_id = $1 AND status IN ('pending', 'approved') 
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
