const { query } = require('../../config/database');
const { createHttpError } = require('../../shared/utils/http-error');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value, field) {
  if (!UUID_REGEX.test(String(value || ''))) {
    throw createHttpError(422, 'VALIDATION_ERROR', 'Errores de validacion', [{
      field,
      message: `El campo ${field} debe ser un UUID valido.`
    }]);
  }
}

function toCatalogOptions(rows) {
  return (rows || [])
    .map((row) => ({
      id: String(row.id || ''),
      name: typeof row.name === 'string' ? row.name.trim() : '',
      ubigeo_code: row.ubigeo_code || row.code || null
    }))
    .filter((item) => UUID_REGEX.test(item.id) && item.name.length > 0);
}

async function getDepartments() {
  const res = await query(
    `SELECT id, BTRIM(name) AS name, COALESCE(ubigeo_code, code) AS ubigeo_code
     FROM geographic_departments
     WHERE deleted_at IS NULL
       AND COALESCE(status, TRUE) = TRUE
       AND NULLIF(BTRIM(name), '') IS NOT NULL
     ORDER BY name ASC`
  );
  return toCatalogOptions(res.rows);
}

async function getProvincesByDepartment(departmentId) {
  assertUuid(departmentId, 'department_id');

  const res = await query(
    `SELECT id, BTRIM(name) AS name, COALESCE(ubigeo_code, code) AS ubigeo_code
     FROM geographic_provinces
     WHERE department_id = $1
       AND deleted_at IS NULL
       AND COALESCE(status, TRUE) = TRUE
       AND NULLIF(BTRIM(name), '') IS NOT NULL
     ORDER BY name ASC`,
    [departmentId]
  );
  return toCatalogOptions(res.rows);
}

async function getDistrictsByProvince(provinceId) {
  assertUuid(provinceId, 'province_id');

  const res = await query(
    `SELECT id, BTRIM(name) AS name, COALESCE(ubigeo_code, code) AS ubigeo_code
     FROM geographic_districts
     WHERE province_id = $1
       AND deleted_at IS NULL
       AND COALESCE(status, TRUE) = TRUE
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
