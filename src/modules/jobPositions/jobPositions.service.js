const { query } = require('../../config/database');
const { insertReturning, updateReturning } = require('../../utils/db.util');
const { createCatalogCache } = require('../../shared/utils/catalog-cache');

const catalogCache = createCatalogCache(60 * 1000);

function createHttpError(statusCode, errorCode, message, errors = undefined) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.errorCode = errorCode;
  if (errors) error.errors = errors;
  return error;
}

async function generateJobPositionCode(companyId, areaId, db = { query }) {
  const areaRes = await db.query('SELECT code FROM areas WHERE id = $1 AND company_id = $2', [areaId, companyId]);
  if (areaRes.rowCount === 0) {
    throw createHttpError(404, 'AREA_NOT_FOUND', 'El área no existe o no pertenece a la empresa.');
  }
  const areaCode = areaRes.rows[0].code || 'AREA';

  const countRes = await db.query(
    'SELECT COUNT(*) as count FROM job_positions WHERE company_id = $1 AND area_id = $2',
    [companyId, areaId]
  );
  
  let nextNumber = parseInt(countRes.rows[0].count, 10) + 1;
  let code = `${areaCode}-${String(nextNumber).padStart(3, '0')}`;
  
  let exists = true;
  while (exists) {
    const res = await db.query('SELECT 1 FROM job_positions WHERE company_id = $1 AND code = $2', [companyId, code]);
    if (res.rowCount === 0) {
      exists = false;
    } else {
      nextNumber++;
      code = `${areaCode}-${String(nextNumber).padStart(3, '0')}`;
    }
  }
  return code;
}

async function getJobPositions(companyId) {
  const cacheKey = `job-positions:${companyId}:all`;
  const cached = catalogCache.get(cacheKey);
  if (cached) return cached;

  const res = await query(
    `SELECT jp.id,
            jp.name,
            jp.area_id,
            a.name AS area_name,
            jp.default_role_id,
            COALESCE(jp.is_active, jp.status, TRUE) AS status,
            jp.name || COALESCE(' (' || a.name || ')', '') AS display_name
     FROM job_positions jp
     LEFT JOIN areas a ON a.id = jp.area_id AND a.deleted_at IS NULL
     WHERE jp.company_id = $1
       AND jp.deleted_at IS NULL
       AND COALESCE(jp.is_active, jp.status, TRUE) = TRUE
     ORDER BY a.name ASC NULLS LAST, jp.name ASC`,
    [companyId]
  );
  return catalogCache.set(cacheKey, res.rows);
}

async function getJobPositionsFiltered(companyId, filters = {}) {
  if (filters.area_id) {
    return getJobPositionsByArea(filters.area_id, companyId);
  }
  return getJobPositions(companyId);
}

async function getJobPositionsByArea(areaId, companyId) {
  const cacheKey = `job-positions:${companyId}:area:${areaId}`;
  const cached = catalogCache.get(cacheKey);
  if (cached) return cached;

  const res = await query(
    `SELECT jp.id,
            jp.name,
            jp.area_id,
            a.name AS area_name,
            jp.default_role_id,
            COALESCE(jp.is_active, jp.status, TRUE) AS status,
            jp.name || COALESCE(' (' || a.name || ')', '') AS display_name
     FROM job_positions jp
     LEFT JOIN areas a ON a.id = jp.area_id AND a.deleted_at IS NULL
     WHERE jp.company_id = $1
       AND jp.area_id = $2
       AND jp.deleted_at IS NULL
       AND COALESCE(jp.is_active, jp.status, TRUE) = TRUE
     ORDER BY jp.name ASC`,
    [companyId, areaId]
  );
  return catalogCache.set(cacheKey, res.rows);
}

async function getJobPositionById(id, companyId) {
  const res = await query(
    `SELECT jp.*,
            COALESCE(jp.is_active, jp.status, TRUE) AS is_active,
            a.name as area_name,
            r.name as default_role_name,
            r.code as default_role_code
     FROM job_positions jp
     LEFT JOIN areas a ON jp.area_id = a.id
     LEFT JOIN roles r ON jp.default_role_id = r.id
     WHERE jp.id = $1 AND jp.company_id = $2 AND jp.deleted_at IS NULL`,
    [id, companyId]
  );
  if (res.rowCount === 0) {
    throw createHttpError(404, 'JOB_POSITION_NOT_FOUND', 'El puesto no existe o no pertenece a la empresa.');
  }
  return res.rows[0];
}

async function createJobPosition(companyId, data) {
  // Check if area exists
  const areaRes = await query('SELECT 1 FROM areas WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL', [data.area_id, companyId]);
  if (areaRes.rowCount === 0) {
    throw createHttpError(422, 'INVALID_AREA', 'El área especificada no existe o no pertenece a la empresa.', [{ field: 'area_id', message: 'Área inválida' }]);
  }

  // Check uniqueness of name in area
  const existsRes = await query(
    'SELECT 1 FROM job_positions WHERE company_id = $1 AND area_id = $2 AND LOWER(name) = LOWER($3) AND deleted_at IS NULL',
    [companyId, data.area_id, data.name]
  );
  if (existsRes.rowCount > 0) {
    throw createHttpError(409, 'JOB_POSITION_ALREADY_EXISTS', 'Ya existe un puesto con ese nombre en esta área.', [
      { field: 'name', message: 'Nombre de puesto duplicado' }
    ]);
  }

  if (data.default_role_id) {
    const roleRes = await query(
      'SELECT 1 FROM roles WHERE id = $1 AND (company_id = $2 OR company_id IS NULL) AND COALESCE(is_active, TRUE) = TRUE AND deleted_at IS NULL',
      [data.default_role_id, companyId]
    );
    if (roleRes.rowCount === 0) {
      throw createHttpError(422, 'ROLE_NOT_FOUND', 'El rol por defecto especificado no existe.', [{ field: 'default_role_id', message: 'Rol inválido' }]);
    }
  }

  const code = await generateJobPositionCode(companyId, data.area_id);
  
  const position = await insertReturning({ query }, 'job_positions', {
    company_id: companyId,
    area_id: data.area_id,
    name: data.name,
    code,
    description: data.description || null,
    level: data.level || null,
    default_role_id: data.default_role_id || null,
    status: data.is_active !== false && data.status !== false,
    is_active: data.is_active !== false && data.status !== false
  });
  catalogCache.clear();
  return position;
}

async function updateJobPosition(id, companyId, data) {
  const position = await getJobPositionById(id, companyId);
  const targetAreaId = data.area_id || position.area_id;

  if (data.area_id && data.area_id !== position.area_id) {
    const areaRes = await query('SELECT 1 FROM areas WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL', [data.area_id, companyId]);
    if (areaRes.rowCount === 0) {
      throw createHttpError(422, 'INVALID_AREA', 'El área especificada no existe.', [{ field: 'area_id', message: 'Área inválida' }]);
    }
  }

  if (data.name && data.name.toLowerCase() !== position.name.toLowerCase()) {
    const existsRes = await query(
      'SELECT 1 FROM job_positions WHERE company_id = $1 AND area_id = $2 AND LOWER(name) = LOWER($3) AND id != $4 AND deleted_at IS NULL',
      [companyId, targetAreaId, data.name, id]
    );
    if (existsRes.rowCount > 0) {
      throw createHttpError(409, 'JOB_POSITION_ALREADY_EXISTS', 'Ya existe un puesto con ese nombre en esta área.', [{ field: 'name', message: 'Nombre de puesto duplicado' }]);
    }
  }

  if (data.default_role_id && data.default_role_id !== position.default_role_id) {
    const roleRes = await query(
      'SELECT 1 FROM roles WHERE id = $1 AND (company_id = $2 OR company_id IS NULL) AND COALESCE(is_active, TRUE) = TRUE AND deleted_at IS NULL',
      [data.default_role_id, companyId]
    );
    if (roleRes.rowCount === 0) {
      throw createHttpError(422, 'ROLE_NOT_FOUND', 'El rol por defecto no existe.', [{ field: 'default_role_id', message: 'Rol inválido' }]);
    }
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

  const updatedPosition = await updateReturning({ query }, 'job_positions', 'id', id, updateData);
  catalogCache.clear();
  return updatedPosition;
}

async function updateJobPositionStatus(id, companyId, isActive) {
  await getJobPositionById(id, companyId);
  if (isActive === false) {
    const activeWorkers = await query(
      `SELECT 1
       FROM workers
       WHERE company_id = $1
         AND deleted_at IS NULL
         AND COALESCE(is_active, TRUE) = TRUE
         AND (job_position_id = $2 OR position_id = $2)
       LIMIT 1`,
      [companyId, id]
    );
    if (activeWorkers.rowCount > 0) {
      throw createHttpError(409, 'JOB_POSITION_HAS_ACTIVE_WORKERS', 'No se puede desactivar este registro porque tiene trabajadores activos asociados.');
    }
  }
  const position = await updateReturning({ query }, 'job_positions', 'id', id, {
    status: isActive,
    is_active: isActive,
    updated_at: new Date()
  });
  catalogCache.clear();
  return position;
}

async function deleteJobPosition(id, companyId, deletedBy = null) {
  await getJobPositionById(id, companyId);

  const activeWorkers = await query(
    `SELECT 1
     FROM workers
     WHERE company_id = $1
       AND deleted_at IS NULL
       AND COALESCE(is_active, TRUE) = TRUE
       AND (job_position_id = $2 OR position_id = $2)
     LIMIT 1`,
    [companyId, id]
  );

  if (activeWorkers.rowCount > 0) {
    throw createHttpError(409, 'JOB_POSITION_HAS_ACTIVE_WORKERS', 'No se puede eliminar un puesto con trabajadores activos asociados.');
  }

  const position = await updateReturning({ query }, 'job_positions', 'id', id, {
    deleted_at: new Date(),
    deleted_by: deletedBy,
    status: false,
    is_active: false,
    updated_at: new Date()
  });
  catalogCache.clear();
  return position;
}

async function getDefaultRole(id, companyId) {
  const position = await getJobPositionById(id, companyId);

  const res = await query(
    `SELECT jp.id AS job_position_id,
            jp.name AS job_position_name,
            a.name AS area_name,
            r.id AS role_id,
            r.code AS role_code,
            r.name AS role_name
     FROM job_positions jp
     LEFT JOIN areas a ON a.id = jp.area_id
     LEFT JOIN roles r ON r.id = jp.default_role_id
     WHERE jp.id = $1
       AND jp.company_id = $2
       AND jp.deleted_at IS NULL`,
    [position.id, companyId]
  );

  const row = res.rows[0];
  return {
    job_position_id: row.job_position_id,
    job_position_name: row.job_position_name,
    area_name: row.area_name,
    default_role: row.role_id ? {
      id: row.role_id,
      code: row.role_code,
      name: row.role_name
    } : null
  };
}

module.exports = {
  getJobPositions,
  getJobPositionsFiltered,
  getJobPositionsByArea,
  getJobPositionById,
  createJobPosition,
  updateJobPosition,
  updateJobPositionStatus,
  deleteJobPosition,
  getDefaultRole
};
