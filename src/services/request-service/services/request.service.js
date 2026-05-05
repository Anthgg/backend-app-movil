const { query } = require('../../../config/database');
const moment = require('moment');
const vacationService = require('./vacation.service');
const { createNotification } = require('../../../shared/utils/notifications');

class RequestService {
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
    const { page = 1, limit = 10, workerId, status } = filters;
    const offset = (page - 1) * limit;

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
        SELECT r.*, w.full_name as worker_name, rt.name as type_name 
        FROM employee_requests r
        JOIN workers w ON r.worker_id = w.id
        JOIN request_types rt ON r.request_type_id = rt.id
        WHERE ${whereString} 
        ORDER BY r.created_at DESC 
        LIMIT $${paramCount++} OFFSET $${paramCount++}`;
    const countQuery = `SELECT COUNT(*) FROM employee_requests r WHERE ${whereString}`;

    const dataPromise = query(dataQuery, [...params, limit, offset]);
    const countPromise = query(countQuery, params.slice(0, paramCount - 3));

    const [dataRes, countRes] = await Promise.all([dataPromise, countPromise]);
    const total = parseInt(countRes.rows[0].count, 10);

    return {
        data: dataRes.rows,
        pagination: { total, page: parseInt(page, 10), limit: parseInt(limit, 10), totalPages: Math.ceil(total / limit) }
    };
  }

  async getRequestById(id, tenantId) {
    const result = await query(`
        SELECT r.*, w.full_name as worker_name, rt.name as type_name 
        FROM employee_requests r
        JOIN workers w ON r.worker_id = w.id
        JOIN request_types rt ON r.request_type_id = rt.id
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
}

module.exports = new RequestService();
