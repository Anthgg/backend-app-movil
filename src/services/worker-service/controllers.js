const { query } = require('../../config/database');
const dniApi = require('./integrations/dniApi.service');
const { getWorkerShift } = require('../attendance-service/services/mobile-attendance.service');
const { WORKER_TYPES } = require('../onboarding-service/validators');
const { updateWorkerLaborAssignment } = require('../../shared/services/labor-assignment.service');
const { uploadFile } = require('../../shared/utils/storage.utils');
const { mapWorkerListItem } = require('../../mappers/worker.mapper');

const WORKER_PROFILE_SELECT = `
  SELECT w.*,
         CONCAT_WS(' ', u.first_name, u.last_name) AS full_name,
         u.email
  FROM workers w
  JOIN users u ON w.user_id = u.id
`;

const mapWorkerProfile = mapWorkerListItem;

const mapWorkerProfiles = (rows) => rows.map(mapWorkerProfile);

const WORKER_NOT_FOUND = { success: false, message: 'Trabajador no encontrado' };

const appendUpdateField = (fields, values, field, value, { allowFalsy = false } = {}) => {
  if (value === undefined || value === null || (!allowFalsy && value === '')) {
    return;
  }

  fields.push(`${field} = $${values.length + 1}`);
  values.push(value);
};

const buildNextBirthday = (birthDate) => {
  const parsed = new Date(birthDate);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const nextBirthday = new Date(Date.UTC(
    now.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate()
  ));

  if (nextBirthday < today) {
    nextBirthday.setUTCFullYear(nextBirthday.getUTCFullYear() + 1);
  }

  return nextBirthday;
};

const filterBirthdayRows = (rows, birthdaysFilter, daysAhead) => {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const currentMonth = today.getUTCMonth() + 1;
  const currentDay = today.getUTCDate();
  const windowEnd = new Date(today);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + (parseInt(daysAhead, 10) || 30));

  return rows
    .filter((row) => {
      if (!row.birth_date) {
        return false;
      }

      const birthDate = new Date(row.birth_date);
      if (Number.isNaN(birthDate.getTime())) {
        return false;
      }

      if (birthdaysFilter === 'today') {
        return birthDate.getUTCMonth() + 1 === currentMonth
          && birthDate.getUTCDate() === currentDay;
      }

      if (birthdaysFilter === 'month') {
        return birthDate.getUTCMonth() + 1 === currentMonth;
      }

      const nextBirthday = buildNextBirthday(row.birth_date);
      return nextBirthday && nextBirthday <= windowEnd;
    })
    .sort((left, right) => {
      const leftDate = buildNextBirthday(left.birth_date);
      const rightDate = buildNextBirthday(right.birth_date);
      return (leftDate?.getTime() || 0) - (rightDate?.getTime() || 0);
    })
    .map((row) => ({
      ...row,
      next_birthday_date: row.birth_date ? buildNextBirthday(row.birth_date)?.toISOString().slice(0, 10) || null : null
    }));
};

const getWorkerProfileById = (id, tenantId) => query(
  `${WORKER_PROFILE_SELECT} WHERE w.id = $1 AND w.company_id = $2 AND w.deleted_at IS NULL`,
  [id, tenantId]
);

const sendWorkerNotFound = (res) => res.status(404).json(WORKER_NOT_FOUND);

exports.getMe = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const tenantId = req.tenantId;

    const result = await query(`
      SELECT w.*,
             u.first_name, u.last_name, u.email as corporate_email, w.personal_email,
             CONCAT_WS(' ', u.first_name, u.last_name) AS full_name,
             p.name as job_position_name,
             d.name as department_name,
             wl.name as work_location_name,
             c.name as company_name
      FROM workers w
      JOIN users u ON w.user_id = u.id
      LEFT JOIN job_positions p ON w.job_position_id = p.id
      LEFT JOIN departments d ON w.internal_department_id = d.id
      LEFT JOIN work_locations wl ON w.work_location_id = wl.id
      LEFT JOIN companies c ON w.company_id = c.id
      WHERE w.user_id = $1 AND w.company_id = $2 AND w.deleted_at IS NULL
    `, [userId, tenantId]);

    if (result.rows.length === 0) {
      if (req.user.roles.includes('ADMIN')) {
        return res.json({ 
          success: true, 
          data: { 
            id: null, 
            full_name: req.user.name || 'Administrador',
            email: req.user.email,
            is_admin_only: true 
          } 
        });
      }
      return res.status(404).json({ success: false, message: 'Perfil de trabajador no encontrado' });
    }

    const row = result.rows[0];
    const shift = await getWorkerShift(row.id, tenantId);

    res.json({
      success: true,
      data: {
        ...mapWorkerProfile(row),
        corporateEmail: row.corporate_email,
        companyName: row.company_name,
        shift
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.updateMe = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const tenantId = req.tenantId;
    const { phone, address, personalEmail } = req.body;

    // 1. Actualizar tabla users (personal_email)
    if (personalEmail) {
      await query(`UPDATE users SET personal_email = $1 WHERE id = $2`, [personalEmail, userId]);
    }

    // 2. Actualizar tabla workers (phone_number, address)
    const updateFields = [];
    const updateValues = [];

    appendUpdateField(updateFields, updateValues, 'phone_number', phone);
    appendUpdateField(updateFields, updateValues, 'address', address);

    if (updateFields.length > 0) {
      await query(
        `UPDATE workers SET ${updateFields.join(', ')} WHERE user_id = $${updateValues.length + 1} AND company_id = $${updateValues.length + 2}`,
        [...updateValues, userId, tenantId]
      );
    }

    // 3. Retornar perfil actualizado
    const finalProfile = await query(`
      SELECT w.*, u.personal_email, CONCAT_WS(' ', u.first_name, u.last_name) AS full_name
      FROM workers w
      JOIN users u ON w.user_id = u.id
      WHERE w.user_id = $1 AND w.company_id = $2
    `, [userId, tenantId]);

    res.json({ success: true, data: finalProfile.rows[0] });
  } catch (error) {
    next(error);
  }
};

exports.getVacationBalance = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const tenantId = req.tenantId;

    // Obtener worker_id
    const workerRes = await query(
      'SELECT id FROM workers WHERE user_id = $1 AND company_id = $2 AND deleted_at IS NULL',
      [userId, tenantId]
    );
    const workerId = workerRes.rows[0]?.id;

    if (!workerId) {
      if (req.user.role === 'ADMIN') {
        return res.json({ 
          success: true, 
          data: { 
            totalAccumulated: 0,
            totalUsed: 0,
            totalPending: 0,
            availableDays: 0,
            lastUpdated: new Date()
          } 
        });
      }
      return res.status(404).json({ success: false, message: 'Perfil de trabajador no encontrado' });
    }

    const result = await query(
      `SELECT accumulated_days, used_days, pending_days, last_updated 
       FROM worker_vacation_balances WHERE worker_id = $1`,
      [workerId]
    );

    const balance = result.rows[0] || {
      accumulated_days: 0,
      used_days: 0,
      pending_days: 0,
      last_updated: new Date()
    };

    res.json({
      success: true,
      data: {
        totalAccumulated: parseFloat(balance.accumulated_days),
        totalUsed: parseFloat(balance.used_days),
        totalPending: parseFloat(balance.pending_days),
        availableDays: parseFloat(balance.accumulated_days) - parseFloat(balance.used_days),
        lastUpdated: balance.last_updated
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.lookupDni = async (req, res, next) => {
  const { dni } = req.params;
  const currentUserId = req.user.id;
  
  try {
    const data = await dniApi.lookupDni(dni);

    // Registrar auditoría de la consulta
    await query(`
      INSERT INTO dni_lookup_logs (dni, requested_by, provider, success, response_status)
      VALUES ($1, $2, $3, $4, $5)
    `, [dni, currentUserId, dniApi.provider, !!data, data ? '200' : '404']);

    if (!data) {
      return res.status(404).json({ success: false, message: 'No se encontraron datos para el DNI ingresado', error_code: 'DNI_NOT_FOUND' });
    }

    res.json({
      success: true,
      data,
      source: 'external_api'
    });

  } catch (error) {
    await query(`
      INSERT INTO dni_lookup_logs (dni, requested_by, provider, success, error_message)
      VALUES ($1, $2, $3, false, $4)
    `, [dni, currentUserId, dniApi.provider, error.message]);

    res.status(500).json({ success: false, message: 'No se pudo consultar el DNI en este momento. Puede registrar los datos manualmente.', error_code: 'DNI_API_ERROR' });
  }
};

exports.disableWorker = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    await query(`
      UPDATE workers 
      SET is_active = false, employment_status = 'inactive', disabled_at = NOW(), disabled_by = $2, disabled_reason = $3
      WHERE id = $1 AND deleted_at IS NULL
    `, [id, req.user.id, reason]);

    res.json({ success: true, message: 'Trabajador desactivado correctamente' });
  } catch (error) {
    next(error);
  }
};

exports.enableWorker = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    await query(`
      UPDATE workers 
      SET is_active = true, employment_status = 'active', disabled_at = null, disabled_by = null, disabled_reason = null
      WHERE id = $1 AND deleted_at IS NULL
    `, [id]);

    res.json({ success: true, message: 'Trabajador activado correctamente' });
  } catch (error) {
    next(error);
  }
};

exports.getAllWorkers = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, project_id, birthdays, daysAhead = 30 } = req.query;
    const pageNumber = parseInt(page, 10) || 1;
    const limitNumber = parseInt(limit, 10) || 10;
    const offset = (pageNumber - 1) * limitNumber;
    const tenantId = req.tenantId;
    const birthdaysFilter = birthdays ? String(birthdays).toLowerCase() : null;
    const shouldFilterBirthdays = ['today', 'upcoming', 'month'].includes(birthdaysFilter);

    let sql = WORKER_PROFILE_SELECT;
    const params = [tenantId];
    let paramIndex = 2;
    let whereClauses = ['w.company_id = $1 AND w.deleted_at IS NULL'];

    if (project_id) {
        sql += ` JOIN project_assignments pa ON w.id = pa.worker_id `;
        whereClauses.push(`pa.project_id = $${paramIndex++} AND pa.unassigned_at IS NULL`);
        params.push(project_id);
    }

    sql += ` WHERE ${whereClauses.join(' AND ')} 
             ORDER BY u.first_name ASC, u.last_name ASC `;

    let rows;
    let total;

    if (shouldFilterBirthdays) {
      const result = await query(sql, params);
      const filtered = filterBirthdayRows(result.rows, birthdaysFilter, daysAhead);
      total = filtered.length;
      rows = mapWorkerProfiles(filtered.slice(offset, offset + limitNumber));
    } else {
      const paginatedSql = `${sql} LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
      const result = await query(paginatedSql, [...params, limitNumber, offset]);
      rows = mapWorkerProfiles(result.rows);

      let countSql = `SELECT COUNT(DISTINCT w.id) FROM workers w `;
      if (project_id) {
          countSql += ` JOIN project_assignments pa ON w.id = pa.worker_id `;
      }
      countSql += ` WHERE w.company_id = $1 AND w.deleted_at IS NULL `;
      if (project_id) {
          countSql += ` AND pa.project_id = $2 AND pa.unassigned_at IS NULL `;
      }

      const totalRes = await query(countSql, project_id ? [tenantId, project_id] : [tenantId]);
      total = parseInt(totalRes.rows[0].count, 10);
    }

    res.json({
      success: true,
      data: rows,
      pagination: {
        total,
        page: pageNumber,
        limit: limitNumber,
        totalPages: Math.ceil(total / limitNumber)
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.getWorkerById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    const result = await getWorkerProfileById(id, tenantId);

    if (result.rows.length === 0) {
      return sendWorkerNotFound(res);
    }
    res.json({ success: true, data: mapWorkerProfile(result.rows[0]) });
  } catch (error) {
    next(error);
  }
};

exports.createWorker = async (req, res, next) => {
  const { user_id, personal_id, phone_number, address, birth_date, hire_date, job_position_id, department_id } = req.body;
  const tenantId = req.tenantId;
  const creatorId = req.user.id;

  if (!hire_date) {
    return res.status(400).json({ success: false, message: 'La fecha de ingreso (hire_date) es obligatoria.', error_code: 'HIRE_DATE_REQUIRED' });
  }

  if (!isValidUUID(user_id)) {
    return res.status(400).json({
      success: false,
      message: 'user_id invalido. Debe ser un UUID valido.',
      code: 'INVALID_USER_ID',
      error_code: 'INVALID_USER_ID',
      errorCode: 'INVALID_USER_ID'
    });
  }

  try {
    await query('BEGIN');

    const userRes = await query('SELECT id FROM users WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL', [user_id, tenantId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
    }

    const workerExists = await query('SELECT id FROM workers WHERE user_id = $1 AND deleted_at IS NULL', [user_id]);
    if (workerExists.rows.length > 0) {
      return res.status(409).json({ success: false, message: 'Este usuario ya tiene un perfil de trabajador.' });
    }

    const newWorkerRes = await query(
      `INSERT INTO workers (user_id, company_id, personal_id, phone_number, address, birth_date, hire_date, job_position_id, department_id, created_by) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [user_id, tenantId, personal_id, phone_number, address, birth_date, hire_date, job_position_id, department_id, creatorId]
    );
    const newWorkerId = newWorkerRes.rows[0].id;

    await query('COMMIT');

    const finalWorker = await query(`${WORKER_PROFILE_SELECT} WHERE w.id = $1`, [newWorkerId]);

    res.status(201).json({ success: true, data: mapWorkerProfile(finalWorker.rows[0]) });
  } catch (error) {
    await query('ROLLBACK');
    next(error);
  }
};

exports.updateWorker = async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    const updaterId = req.user.id;
    const {
      personal_id,
      phone_number,
      address,
      birth_date,
      job_position_id,
      department_id,
      is_active,
      sede_id,
      internal_department_id,
      area_id,
      position_id,
      work_location_id
    } = req.body;

    const workerRes = await query('SELECT * FROM workers WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL', [id, tenantId]);
    if (workerRes.rows.length === 0) {
      return sendWorkerNotFound(res);
    }

    const updateFields = [];
    const updateValues = [];

    appendUpdateField(updateFields, updateValues, 'personal_id', personal_id);
    appendUpdateField(updateFields, updateValues, 'phone_number', phone_number);
    appendUpdateField(updateFields, updateValues, 'address', address);
    appendUpdateField(updateFields, updateValues, 'birth_date', birth_date);
    appendUpdateField(updateFields, updateValues, 'job_position_id', job_position_id);
    appendUpdateField(updateFields, updateValues, 'department_id', department_id);
    appendUpdateField(updateFields, updateValues, 'is_active', is_active, { allowFalsy: true });

    const hasLaborAssignment = [sede_id, internal_department_id, area_id, position_id, work_location_id].some((value) => value !== undefined);

    if (updateFields.length === 0 && !hasLaborAssignment) {
        return res.status(400).json({ success: false, message: 'No se proporcionaron datos para actualizar.' });
    }

    if (updateFields.length > 0) {
      updateFields.push('updated_at = NOW()');
      updateValues.push(updaterId);

      const updateQuery = `UPDATE workers SET ${updateFields.join(', ')}, updated_by = $${updateValues.length + 1} WHERE id = $${updateValues.length + 2} AND company_id = $${updateValues.length + 3}`;

      await query(updateQuery, [...updateValues, id, tenantId]);
    }

    if (hasLaborAssignment) {
      await updateWorkerLaborAssignment(id, tenantId, {
        sede_id,
        internal_department_id,
        area_id,
        position_id,
        job_position_id,
        work_location_id
      });
    }
    
    const finalWorker = await query(`${WORKER_PROFILE_SELECT} WHERE w.id = $1`, [id]);

    res.json({ success: true, data: mapWorkerProfile(finalWorker.rows[0]) });
  } catch (error) {
    next(error);
  }
};

exports.updateLaborAssignment = async (req, res, next) => {
  try {
    const worker = await updateWorkerLaborAssignment(req.params.id, req.tenantId, req.body);
    res.json({
      success: true,
      message: 'Asignación laboral actualizada correctamente',
      data: worker
    });
  } catch (error) {
    next(error);
  }
};

exports.updateWorkLocationAssignment = async (req, res, next) => {
  try {
    if (!req.body?.work_location_id) {
      return res.status(422).json({
        success: false,
        message: 'El lugar de trabajo es obligatorio.',
        errorCode: 'VALIDATION_ERROR',
        error_code: 'VALIDATION_ERROR',
        errors: [{ field: 'work_location_id', message: 'El lugar de trabajo es obligatorio.' }]
      });
    }
    const workerRes = await query(
      `SELECT id, company_id
       FROM workers
       WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
      [req.params.id, req.tenantId]
    );
    if (workerRes.rowCount === 0) {
      return sendWorkerNotFound(res);
    }

    const locationRes = await query(
      `SELECT id, name
       FROM work_locations
       WHERE id = $1
         AND company_id = $2
         AND deleted_at IS NULL
         AND COALESCE(is_active, status, TRUE) = TRUE`,
      [req.body.work_location_id, req.tenantId]
    );
    if (locationRes.rowCount === 0) {
      return res.status(422).json({
        success: false,
        message: 'El lugar de trabajo no existe, no está activo o no pertenece a la empresa.',
        errorCode: 'INVALID_WORK_LOCATION_COMPANY',
        error_code: 'INVALID_WORK_LOCATION_COMPANY',
        errors: [{ field: 'work_location_id', message: 'Lugar de trabajo inválido' }]
      });
    }

    await query(
      `UPDATE workers
       SET work_location_id = $1, updated_at = NOW()
       WHERE id = $2 AND company_id = $3`,
      [req.body.work_location_id, req.params.id, req.tenantId]
    );
    const result = await query(
      `SELECT w.id,
              CONCAT_WS(' ', u.first_name, u.last_name) AS name,
              w.work_location_id,
              wl.name AS work_location_name
       FROM workers w
       JOIN users u ON u.id = w.user_id
       LEFT JOIN work_locations wl ON wl.id = w.work_location_id
       WHERE w.id = $1 AND w.company_id = $2`,
      [req.params.id, req.tenantId]
    );
    res.json({
      success: true,
      message: 'Lugar de trabajo asignado correctamente.',
      worker: result.rows[0],
      data: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
};

exports.deleteWorker = async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    const deleterId = req.user.id;

    const workerRes = await query('SELECT id FROM workers WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL', [id, tenantId]);
    if (workerRes.rows.length === 0) {
      return sendWorkerNotFound(res);
    }

    await query('UPDATE workers SET deleted_at = NOW(), is_active = false, employment_status = \'terminated\', deleted_by = $1 WHERE id = $2', [deleterId, id]);

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

exports.getCompaniesCatalog = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, name FROM companies WHERE deleted_at IS NULL ORDER BY name ASC`
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
};

exports.getBranchesCatalog = async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    const result = await query(
      `SELECT id, name FROM projects WHERE company_id = $1 AND deleted_at IS NULL ORDER BY name ASC`,
      [tenantId]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
};

exports.getAreasCatalog = async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    const result = await query(
      `SELECT id, name FROM areas WHERE company_id = $1 AND deleted_at IS NULL AND COALESCE(is_active, status, TRUE) = TRUE ORDER BY name ASC`,
      [tenantId]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
};

exports.getPositionsCatalog = async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    const result = await query(
      `SELECT id, name FROM job_positions WHERE company_id = $1 AND deleted_at IS NULL ORDER BY name ASC`,
      [tenantId]
    );
    res.json({ success: true, data: result.rows });

  } catch (error) {
    next(error);
  }
};

exports.getWorkerTypesCatalog = async (req, res, next) => {
  try {
    res.json({ success: true, data: WORKER_TYPES });
  } catch (error) {
    next(error);
  }
};

exports.getShiftsCatalog = async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    const result = await query(
      `SELECT id, name FROM shifts WHERE company_id = $1 AND is_active = true ORDER BY name ASC`,
      [tenantId]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
};

exports.getSupervisorsCatalog = async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    const result = await query(
      `SELECT id, CONCAT_WS(' ', first_name, last_name) AS name 
       FROM users 
       WHERE company_id = $1 AND deleted_at IS NULL AND is_active = true 
       ORDER BY name ASC`,
      [tenantId]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
};

exports.getWorkerDocuments = async (req, res, next) => {
  try {
    const { workerId } = req.params;
    const tenantId = req.tenantId;

    const docRes = await query(`
      SELECT 
        id, worker_id AS "workerId", document_type AS type, file_name AS name,
        file_name AS "fileName", mime_type AS "mimeType", size_bytes AS size,
        uploaded_at AS "createdAt", file_url AS url,
        (SELECT CONCAT_WS(' ', first_name, last_name) FROM users u WHERE u.id = wd.uploaded_by) AS "createdBy"
      FROM worker_documents wd
      WHERE worker_id = $1 AND company_id = $2 AND status != 'deleted'
      ORDER BY uploaded_at DESC
    `, [workerId, tenantId]);

    res.json({ success: true, items: docRes.rows });
  } catch (error) {
    next(error);
  }
};

exports.uploadWorkerDocument = async (req, res, next) => {
  try {
    const { workerId } = req.params;
    const { type, name, fileName, mimeType, contentBase64 } = req.body;
    const tenantId = req.tenantId;

    if (!contentBase64) {
      return res.status(400).json({ success: false, message: 'contentBase64 es requerido' });
    }

    const buffer = Buffer.from(contentBase64, 'base64');
    const finalFileName = fileName || name || `doc_${Date.now()}.pdf`;
    const filePath = `${tenantId}/${workerId}/${Date.now()}_${finalFileName}`;

    const fileObj = {
      buffer,
      mimetype: mimeType || 'application/pdf'
    };

    const publicUrl = await uploadFile(fileObj, 'worker-documents', filePath);

    const docRes = await query(`
      INSERT INTO worker_documents (worker_id, company_id, document_type, file_name, file_url, file_path, mime_type, size_bytes, status, uploaded_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, worker_id AS "workerId", document_type AS type, file_name AS name, file_name AS "fileName", mime_type AS "mimeType", file_url AS url, uploaded_at AS "createdAt"
    `, [
      workerId, tenantId, type || 'OTHER', name || finalFileName, publicUrl, filePath, mimeType || 'application/pdf', buffer.length, 'active', req.user.id
    ]);

    res.status(201).json({ success: true, document: docRes.rows[0] });
  } catch (error) {
    next(error);
  }
};

exports.getCompletionStatus = async (req, res, next) => {
  try {
    const { workerId } = req.params;
    const tenantId = req.tenantId;

    const workerRes = await query(`
      SELECT w.document_number, w.position_id, w.internal_department_id AS department_id,
             w.area_id, w.work_location_id, w.hire_date, w.contract_type,
             (SELECT crew_id FROM crew_workers cw WHERE cw.worker_id = w.id LIMIT 1) AS crew_id,
             w.supervisor_id
      FROM workers w
      WHERE w.id = $1 AND w.company_id = $2 AND w.deleted_at IS NULL
    `, [workerId, tenantId]);

    if (workerRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Trabajador no encontrado' });
    }

    const w = workerRes.rows[0];
    const missingFields = [];

    if (!w.document_number) missingFields.push('documentNumber');
    if (!w.position_id) missingFields.push('positionId');
    if (!w.department_id) missingFields.push('departmentId');
    if (!w.area_id) missingFields.push('areaId');
    if (!w.work_location_id) missingFields.push('workLocationId');
    if (!w.hire_date) missingFields.push('hireDate');
    if (!w.contract_type) missingFields.push('contractType');
    // crew_id and supervisor_id might be optional depending on role, but we list them if null
    if (!w.crew_id) missingFields.push('crewId');
    if (!w.supervisor_id) missingFields.push('supervisorId');

    res.json({
      success: true,
      missingFields,
      isComplete: missingFields.length === 0
    });
  } catch (error) {
    next(error);
  }
};

exports.updateLaborInfo = async (req, res, next) => {
  try {
    const { workerId } = req.params;
    const { documentNumber, departmentId, areaId, positionId, workLocationId, crewId, supervisorId, hireDate, contractType } = req.body;
    const tenantId = req.tenantId;

    await query('BEGIN');

    // Simple validations could be added here for relationships (e.g. position belongs to area)
    
    const updateRes = await query(`
      UPDATE workers
      SET document_number = $1,
          internal_department_id = $2,
          area_id = $3,
          position_id = $4,
          job_position_id = $4,
          work_location_id = $5,
          supervisor_id = $6,
          hire_date = $7,
          contract_type = $8,
          updated_at = NOW()
      WHERE id = $9 AND company_id = $10
      RETURNING id, document_number AS "documentNumber", internal_department_id AS "departmentId", area_id AS "areaId", position_id AS "positionId", work_location_id AS "workLocationId", supervisor_id AS "supervisorId", hire_date AS "hireDate", contract_type AS "contractType", updated_at AS "updatedAt"
    `, [documentNumber, departmentId, areaId, positionId, workLocationId, supervisorId, hireDate, contractType, workerId, tenantId]);

    if (updateRes.rows.length === 0) {
      await query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Trabajador no encontrado' });
    }

    const updatedWorker = updateRes.rows[0];

    // Handle crew assignment if provided
    if (crewId !== undefined) {
      await query(`UPDATE crew_workers SET deleted_at = NOW() WHERE worker_id = $1`, [workerId]);
      if (crewId) {
        await query(`INSERT INTO crew_workers (crew_id, worker_id, assigned_at) VALUES ($1, $2, NOW())`, [crewId, workerId]);
      }
    }

    updatedWorker.crewId = crewId;

    await query('COMMIT');
    res.json({ success: true, worker: updatedWorker });
  } catch (error) {
    await query('ROLLBACK');
    next(error);
  }
};
