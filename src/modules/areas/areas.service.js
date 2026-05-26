const { query } = require('../../config/database');
const { insertReturning, updateReturning } = require('../../utils/db.util');

function createHttpError(statusCode, errorCode, message, errors = undefined) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.errorCode = errorCode;
  if (errors) error.errors = errors;
  return error;
}

async function generateAreaCode(companyId, name, db = { query }) {
  let baseCode = name.replace(/[^A-Za-z]/g, '').substring(0, 3).toUpperCase();
  if (baseCode.length < 3) {
    baseCode = baseCode.padEnd(3, 'X');
  }

  let code = baseCode;
  let counter = 1;
  let exists = true;

  while (exists) {
    const res = await db.query(
      'SELECT 1 FROM areas WHERE company_id = $1 AND code = $2 AND deleted_at IS NULL',
      [companyId, code]
    );
    if (res.rowCount === 0) {
      exists = false;
    } else {
      code = `${baseCode}${counter}`;
      counter++;
    }
  }

  return code;
}

async function validateDepartment(departmentId, companyId) {
  const res = await query(
    `SELECT 1 FROM departments
     WHERE id = $1
       AND company_id = $2
       AND deleted_at IS NULL
       AND COALESCE(is_active, status, TRUE) = TRUE`,
    [departmentId, companyId]
  );
  if (res.rowCount === 0) {
    throw createHttpError(
      422,
      'DEPARTMENT_NOT_FOUND',
      'El departamento interno no pertenece a la empresa.',
      [{ field: 'department_id', message: 'Departamento inválido' }]
    );
  }
}

/**
 * Validate that a role exists (global or company-specific).
 */
async function validateRole(roleId, companyId) {
  if (!roleId) return;
  const res = await query(
    `SELECT 1 FROM roles
     WHERE id = $1
       AND (company_id = $2 OR company_id IS NULL)
       AND COALESCE(is_active, TRUE) = TRUE
       AND deleted_at IS NULL`,
    [roleId, companyId]
  );
  if (res.rowCount === 0) {
    throw createHttpError(
      422,
      'ROLE_NOT_FOUND',
      'El rol seleccionado no existe',
      [{ field: 'role_id', message: 'Rol inválido' }]
    );
  }
}

// ─── SELECT helper ───────────────────────────────────────────────────────────

const AREA_SELECT = `
  SELECT
    a.id,
    a.company_id,
    a.name,
    a.code,
    a.description,
    a.department_id,
    d.name   AS department_name,
    a.role_id,
    r.name   AS role_name,
    r.code   AS role_code,
    COALESCE(a.is_active, a.status, TRUE) AS is_active,
    a.status,
    a.created_at,
    a.updated_at
  FROM areas a
  LEFT JOIN departments d ON d.id = a.department_id
  LEFT JOIN roles       r ON r.id = a.role_id
`;

// ─── Service functions ────────────────────────────────────────────────────────

async function getAreas(companyId) {
  const res = await query(
    `${AREA_SELECT}
     WHERE a.company_id = $1 AND a.deleted_at IS NULL
     ORDER BY a.name ASC`,
    [companyId]
  );
  return res.rows;
}

async function getAreasByDepartment(departmentId, companyId) {
  const res = await query(
    `${AREA_SELECT}
     WHERE a.company_id = $1
       AND a.department_id = $2
       AND a.deleted_at IS NULL
       AND COALESCE(a.is_active, a.status, TRUE) = TRUE
     ORDER BY a.name ASC`,
    [companyId, departmentId]
  );
  return res.rows;
}

async function getAreasFiltered(companyId, filters = {}) {
  if (filters.department_id) {
    return getAreasByDepartment(filters.department_id, companyId);
  }
  return getAreas(companyId);
}

async function getAreaById(id, companyId) {
  const res = await query(
    `${AREA_SELECT}
     WHERE a.id = $1 AND a.company_id = $2 AND a.deleted_at IS NULL`,
    [id, companyId]
  );
  if (res.rowCount === 0) {
    throw createHttpError(404, 'AREA_NOT_FOUND', 'El área no existe o no pertenece a la empresa.');
  }
  return res.rows[0];
}

async function createArea(companyId, data) {
  // Check uniqueness by name within company
  const existsRes = await query(
    'SELECT 1 FROM areas WHERE company_id = $1 AND LOWER(name) = LOWER($2) AND deleted_at IS NULL',
    [companyId, data.name]
  );
  if (existsRes.rowCount > 0) {
    throw createHttpError(409, 'AREA_ALREADY_EXISTS', 'Ya existe un área con ese nombre en la empresa.', [
      { field: 'name', message: 'Nombre de área duplicado' }
    ]);
  }

  // Validate department and role
  await validateDepartment(data.department_id, companyId);
  await validateRole(data.role_id, companyId);

  const code = await generateAreaCode(companyId, data.name);

  return insertReturning({ query }, 'areas', {
    company_id:    companyId,
    name:          data.name,
    code,
    description:   data.description || null,
    department_id: data.department_id,
    role_id:       data.role_id || null,
    status:        data.is_active !== false && data.status !== false,
    is_active:     data.is_active !== false && data.status !== false
  });
}

async function updateArea(id, companyId, data) {
  const area = await getAreaById(id, companyId);

  if (data.name && data.name.toLowerCase() !== area.name.toLowerCase()) {
    const existsRes = await query(
      'SELECT 1 FROM areas WHERE company_id = $1 AND LOWER(name) = LOWER($2) AND id != $3 AND deleted_at IS NULL',
      [companyId, data.name, id]
    );
    if (existsRes.rowCount > 0) {
      throw createHttpError(409, 'AREA_ALREADY_EXISTS', 'Ya existe un área con ese nombre en la empresa.', [
        { field: 'name', message: 'Nombre de área duplicado' }
      ]);
    }
  }

  // Validate department and role only if they are being changed
  if (data.department_id !== undefined && data.department_id !== area.department_id) {
    await validateDepartment(data.department_id, companyId);
  }
  if (data.role_id !== undefined && data.role_id !== area.role_id) {
    await validateRole(data.role_id, companyId);
  }

  const updateData = {
    ...data,
    updated_at: new Date()
  };

  if (data.is_active !== undefined) {
    updateData.status = data.is_active;
  }
  if (data.status !== undefined) {
    updateData.is_active = data.status;
  }

  return updateReturning({ query }, 'areas', 'id', id, updateData);
}

async function updateAreaStatus(id, companyId, isActive) {
  await getAreaById(id, companyId);
  if (isActive === false) {
    const activeWorkers = await query(
      `SELECT 1 FROM workers
       WHERE company_id = $1
         AND area_id = $2
         AND deleted_at IS NULL
         AND COALESCE(is_active, TRUE) = TRUE
       LIMIT 1`,
      [companyId, id]
    );
    if (activeWorkers.rowCount > 0) {
      throw createHttpError(409, 'AREA_HAS_ACTIVE_WORKERS', 'No se puede desactivar este registro porque tiene trabajadores activos asociados.');
    }
  }
  return updateReturning({ query }, 'areas', 'id', id, {
    status:     isActive,
    is_active:  isActive,
    updated_at: new Date()
  });
}

async function deleteArea(id, companyId, deletedBy = null) {
  await getAreaById(id, companyId);

  const activePositions = await query(
    `SELECT 1
     FROM job_positions
     WHERE area_id = $1
       AND company_id = $2
       AND deleted_at IS NULL
       AND COALESCE(is_active, status, TRUE) = TRUE
     LIMIT 1`,
    [id, companyId]
  );

  if (activePositions.rowCount > 0) {
    throw createHttpError(409, 'AREA_HAS_ACTIVE_JOB_POSITIONS', 'No se puede eliminar un área con puestos activos.');
  }

  return updateReturning({ query }, 'areas', 'id', id, {
    deleted_at:  new Date(),
    deleted_by:  deletedBy,
    status:      false,
    is_active:   false,
    updated_at:  new Date()
  });
}

module.exports = {
  getAreas,
  getAreasFiltered,
  getAreasByDepartment,
  getAreaById,
  createArea,
  updateArea,
  updateAreaStatus,
  deleteArea
};
