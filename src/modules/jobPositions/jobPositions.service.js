const { query } = require('../../config/database');
const { insertReturning, updateReturning } = require('../../utils/db.util');

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
  const res = await query(
    `SELECT jp.*, a.name as area_name, r.name as default_role_name
     FROM job_positions jp
     LEFT JOIN areas a ON jp.area_id = a.id
     LEFT JOIN roles r ON jp.default_role_id = r.id
     WHERE (jp.company_id = $1 OR jp.company_id IS NULL) AND jp.deleted_at IS NULL
     ORDER BY jp.created_at ASC`,
    [companyId]
  );
  return res.rows;
}

async function getJobPositionsByArea(areaId, companyId) {
  const res = await query(
    `SELECT jp.*, r.name as default_role_name
     FROM job_positions jp
     LEFT JOIN roles r ON jp.default_role_id = r.id
     WHERE (jp.company_id = $1 OR jp.company_id IS NULL) AND jp.area_id = $2 AND jp.deleted_at IS NULL
     ORDER BY jp.created_at ASC`,
    [companyId, areaId]
  );
  return res.rows;
}

async function getJobPositionById(id, companyId) {
  const res = await query(
    `SELECT jp.*, a.name as area_name, r.name as default_role_name
     FROM job_positions jp
     LEFT JOIN areas a ON jp.area_id = a.id
     LEFT JOIN roles r ON jp.default_role_id = r.id
     WHERE jp.id = $1 AND (jp.company_id = $2 OR jp.company_id IS NULL) AND jp.deleted_at IS NULL`,
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
    const roleRes = await query('SELECT 1 FROM roles WHERE id = $1 AND (company_id = $2 OR company_id IS NULL)', [data.default_role_id, companyId]);
    if (roleRes.rowCount === 0) {
      throw createHttpError(422, 'ROLE_NOT_FOUND', 'El rol por defecto especificado no existe.', [{ field: 'default_role_id', message: 'Rol inválido' }]);
    }
  }

  const code = await generateJobPositionCode(companyId, data.area_id);
  
  return insertReturning({ query }, 'job_positions', {
    company_id: companyId,
    area_id: data.area_id,
    name: data.name,
    code,
    description: data.description || null,
    level: data.level || null,
    default_role_id: data.default_role_id || null,
    status: data.status !== false
  });
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
    const roleRes = await query('SELECT 1 FROM roles WHERE id = $1 AND (company_id = $2 OR company_id IS NULL)', [data.default_role_id, companyId]);
    if (roleRes.rowCount === 0) {
      throw createHttpError(422, 'ROLE_NOT_FOUND', 'El rol por defecto no existe.', [{ field: 'default_role_id', message: 'Rol inválido' }]);
    }
  }

  const updateData = {
    ...data
  };

  return updateReturning({ query }, 'job_positions', 'id', id, updateData);
}

async function updateJobPositionStatus(id, companyId, status) {
  await getJobPositionById(id, companyId);
  return updateReturning({ query }, 'job_positions', 'id', id, { status });
}

module.exports = {
  getJobPositions,
  getJobPositionsByArea,
  getJobPositionById,
  createJobPosition,
  updateJobPosition,
  updateJobPositionStatus
};
