const { query } = require('../../config/database');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createHttpError(statusCode, errorCode, message, errors = undefined) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.errorCode = errorCode;
  if (errors) error.errors = errors;
  return error;
}

function assertUuid(value, field) {
  if (!UUID_REGEX.test(String(value || ''))) {
    throw createHttpError(422, 'VALIDATION_ERROR', 'Errores de validacion', [{
      field,
      message: `El campo ${field} debe ser un UUID valido.`
    }]);
  }
}

function toCatalogOptions(rows) {
  if (!Array.isArray(rows)) return [];

  return rows
    .map(row => ({
      id: String(row.id || ''),
      name: typeof row.name === 'string' ? row.name.trim() : ''
    }))
    .filter(item => UUID_REGEX.test(item.id) && item.name.length > 0);
}

async function getDepartments() {
  const res = await query(
    `SELECT id, BTRIM(name) AS name
     FROM departments
     WHERE deleted_at IS NULL
       AND status = true
       AND NULLIF(BTRIM(name), '') IS NOT NULL
     ORDER BY name ASC`
  );
  return toCatalogOptions(res.rows);
}

async function getProvincesByDepartment(departmentId) {
  assertUuid(departmentId, 'departmentId');

  const res = await query(
    `SELECT id, BTRIM(name) AS name
     FROM provinces
     WHERE department_id = $1
       AND deleted_at IS NULL
       AND status = true
       AND NULLIF(BTRIM(name), '') IS NOT NULL
     ORDER BY name ASC`,
    [departmentId]
  );
  return toCatalogOptions(res.rows);
}

async function getDistrictsByProvince(provinceId) {
  assertUuid(provinceId, 'provinceId');

  const res = await query(
    `SELECT id, BTRIM(name) AS name
     FROM districts
     WHERE province_id = $1
       AND deleted_at IS NULL
       AND status = true
       AND NULLIF(BTRIM(name), '') IS NOT NULL
     ORDER BY name ASC`,
    [provinceId]
  );
  return toCatalogOptions(res.rows);
}

module.exports = {
  getDepartments,
  getProvincesByDepartment,
  getDistrictsByProvince
};
