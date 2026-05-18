const { query } = require('../../config/database');
const dniApi = require('./integrations/dniApi.service');
const { getWorkerShift } = require('../attendance-service/services/mobile-attendance.service');

const WORKER_PROFILE_SELECT = `
  SELECT w.*,
         CONCAT_WS(' ', u.first_name, u.last_name) AS full_name,
         u.email
  FROM workers w
  JOIN users u ON w.user_id = u.id
`;

const mapWorkerProfile = (row) => ({
  ...row,
  fullName: row.full_name,
  email: row.email
});

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
             p.title as job_position_name,
             NULL::text as department_name,
             c.name as company_name
      FROM workers w
      JOIN users u ON w.user_id = u.id
      LEFT JOIN job_positions p ON w.job_position_id = p.id
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
      rows = filtered.slice(offset, offset + limitNumber);
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
    const { personal_id, phone_number, address, birth_date, job_position_id, department_id, is_active } = req.body;

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

    if (updateFields.length === 0) {
        return res.status(400).json({ success: false, message: 'No se proporcionaron datos para actualizar.' });
    }

    updateFields.push('updated_at = NOW()');
    updateValues.push(updaterId);

    const updateQuery = `UPDATE workers SET ${updateFields.join(', ')}, updated_by = $${updateValues.length + 1} WHERE id = $${updateValues.length + 2} AND company_id = $${updateValues.length + 3}`;

    await query(updateQuery, [...updateValues, id, tenantId]);
    
    const finalWorker = await query(`${WORKER_PROFILE_SELECT} WHERE w.id = $1`, [id]);

    res.json({ success: true, data: mapWorkerProfile(finalWorker.rows[0]) });
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
