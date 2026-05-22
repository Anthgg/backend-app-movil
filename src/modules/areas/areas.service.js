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

async function getAreas(companyId) {
  const res = await query(
    `SELECT id, name, code, description, status, created_at
     FROM areas
     WHERE (company_id = $1 OR company_id IS NULL) AND deleted_at IS NULL
     ORDER BY name ASC`,
    [companyId]
  );
  return res.rows;
}

async function getAreaById(id, companyId) {
  const res = await query(
    `SELECT id, name, code, description, status, created_at
     FROM areas
     WHERE id = $1 AND (company_id = $2 OR company_id IS NULL) AND deleted_at IS NULL`,
    [id, companyId]
  );
  if (res.rowCount === 0) {
    throw createHttpError(404, 'AREA_NOT_FOUND', 'El área no existe o no pertenece a la empresa.');
  }
  return res.rows[0];
}

async function createArea(companyId, data) {
  // Check uniqueness
  const existsRes = await query(
    'SELECT 1 FROM areas WHERE company_id = $1 AND LOWER(name) = LOWER($2) AND deleted_at IS NULL',
    [companyId, data.name]
  );
  if (existsRes.rowCount > 0) {
    throw createHttpError(409, 'AREA_ALREADY_EXISTS', 'Ya existe un área con ese nombre en la empresa.', [
      { field: 'name', message: 'Nombre de área duplicado' }
    ]);
  }

  const code = await generateAreaCode(companyId, data.name);
  
  return insertReturning({ query }, 'areas', {
    company_id: companyId,
    name: data.name,
    code,
    description: data.description || null,
    status: data.status !== false
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

  const updateData = {
    ...data
  };

  return updateReturning({ query }, 'areas', 'id', id, updateData);
}

async function updateAreaStatus(id, companyId, status) {
  await getAreaById(id, companyId);
  return updateReturning({ query }, 'areas', 'id', id, { status });
}

module.exports = {
  getAreas,
  getAreaById,
  createArea,
  updateArea,
  updateAreaStatus
};
