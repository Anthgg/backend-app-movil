const { query } = require('../../config/database');
const { insertReturning, updateReturning } = require('../../utils/db.util');
const { createHttpError } = require('../../shared/utils/http-error');
const { validateGeography } = require('../../shared/services/labor-assignment.service');
const { createCatalogCache } = require('../../shared/utils/catalog-cache');

const catalogCache = createCatalogCache(60 * 1000);

function shouldIncludeInactive(filters = {}) {
  return filters.include_inactive === true
    || filters.include_inactive === 'true'
    || filters.status === 'all';
}

function normalizePayload(data = {}) {
  return {
    ...data,
    geographic_department_id: data.geographic_department_id || data.department_id,
    geographic_province_id: data.geographic_province_id || data.province_id,
    geographic_district_id: data.geographic_district_id || data.district_id
  };
}

const WORK_LOCATION_SELECT = `
  SELECT wl.id, wl.company_id, wl.sede_id, wl.name, wl.description, wl.address,
         wl.geographic_department_id, gd.name AS geographic_department_name,
         wl.geographic_department_id AS department_id, gd.name AS department_name,
         wl.geographic_province_id, gp.name AS geographic_province_name,
         wl.geographic_province_id AS province_id, gp.name AS province_name,
         wl.geographic_district_id, gdi.name AS geographic_district_name,
         wl.geographic_district_id AS district_id, gdi.name AS district_name,
         wl.latitude, wl.longitude, wl.allowed_radius_meters,
         COALESCE(wl.is_active, wl.status, TRUE) AS is_active,
         wl.status, wl.created_at, wl.updated_at
  FROM work_locations wl
  LEFT JOIN geographic_departments gd ON gd.id = wl.geographic_department_id
  LEFT JOIN geographic_provinces gp ON gp.id = wl.geographic_province_id
  LEFT JOIN geographic_districts gdi ON gdi.id = wl.geographic_district_id
`;

const WORK_LOCATION_CATALOG_SELECT = `
  SELECT wl.id, wl.name, wl.description, wl.address, wl.sede_id,
         wl.geographic_department_id, wl.geographic_province_id, wl.geographic_district_id,
         wl.geographic_department_id AS department_id,
         wl.geographic_province_id AS province_id,
         wl.geographic_district_id AS district_id,
         gd.name AS geographic_department_name,
         gp.name AS geographic_province_name,
         gdi.name AS geographic_district_name,
         gd.name AS department_name,
         gp.name AS province_name,
         gdi.name AS district_name,
         wl.latitude, wl.longitude, wl.allowed_radius_meters,
         COALESCE(wl.is_active, wl.status, TRUE) AS is_active,
         COALESCE(wl.is_active, wl.status, TRUE) AS status,
         jsonb_build_object(
           'base_crew_workers', COALESCE(metrics.base_crew_workers, 0),
           'temporary_received', COALESCE(metrics.temporary_received, 0),
           'temporary_sent', COALESCE(metrics.temporary_sent, 0),
           'total_movements', COALESCE(metrics.total_movements, 0),
           'total_active', COALESCE(metrics.base_crew_workers, 0) + COALESCE(metrics.temporary_received, 0)
         ) AS workers_metrics
  FROM work_locations wl
  LEFT JOIN geographic_departments gd ON gd.id = wl.geographic_department_id
  LEFT JOIN geographic_provinces gp ON gp.id = wl.geographic_province_id
  LEFT JOIN geographic_districts gdi ON gdi.id = wl.geographic_district_id
  LEFT JOIN LATERAL (
    SELECT
      COUNT(DISTINCT cw.worker_id) FILTER (
        WHERE cw.id IS NOT NULL
          AND base_worker.id IS NOT NULL
      )::int AS base_crew_workers,
      COUNT(DISTINCT cw.worker_id) FILTER (
        WHERE cw.id IS NOT NULL
          AND base_worker.id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM worker_location_assignments out_wla
            WHERE out_wla.company_id = scoped_wl.company_id
              AND out_wla.worker_id = cw.worker_id
              AND out_wla.assignment_type = 'temporary'
              AND out_wla.is_active = TRUE
              AND out_wla.start_date <= CURRENT_DATE
              AND (out_wla.end_date IS NULL OR out_wla.end_date >= CURRENT_DATE)
              AND out_wla.work_location_id IS DISTINCT FROM scoped_wl.id
          )
      )::int AS temporary_sent,
      (
        SELECT COUNT(wah.id)::int
        FROM worker_assignment_history wah
        WHERE wah.company_id = scoped_wl.company_id
          AND (wah.previous_work_location_id = scoped_wl.id OR wah.new_work_location_id = scoped_wl.id)
      ) AS total_movements,
      COUNT(DISTINCT wla.worker_id) FILTER (
        WHERE wla.id IS NOT NULL
          AND temp_worker.id IS NOT NULL
          AND temp_wc.work_location_id IS DISTINCT FROM scoped_wl.id
      )::int AS temporary_received
    FROM work_locations scoped_wl
    LEFT JOIN work_crews wc ON wc.company_id = scoped_wl.company_id
      AND wc.work_location_id = scoped_wl.id
      AND wc.deleted_at IS NULL
      AND COALESCE(wc.is_active, wc.status, TRUE) = TRUE
    LEFT JOIN crew_workers cw ON cw.company_id = scoped_wl.company_id
      AND cw.crew_id = wc.id
      AND cw.is_active = TRUE
      AND cw.unassigned_at IS NULL
    LEFT JOIN workers base_worker ON base_worker.id = cw.worker_id
      AND base_worker.company_id = scoped_wl.company_id
      AND base_worker.deleted_at IS NULL
      AND COALESCE(base_worker.is_active, TRUE) = TRUE
      AND COALESCE(base_worker.employment_status, 'active') = 'active'
    LEFT JOIN worker_location_assignments wla ON wla.company_id = scoped_wl.company_id
      AND wla.work_location_id = scoped_wl.id
      AND wla.assignment_type = 'temporary'
      AND wla.is_active = TRUE
      AND wla.start_date <= CURRENT_DATE
      AND (wla.end_date IS NULL OR wla.end_date >= CURRENT_DATE)
    LEFT JOIN workers temp_worker ON temp_worker.id = wla.worker_id
      AND temp_worker.company_id = scoped_wl.company_id
      AND temp_worker.deleted_at IS NULL
      AND COALESCE(temp_worker.is_active, TRUE) = TRUE
      AND COALESCE(temp_worker.employment_status, 'active') = 'active'
    LEFT JOIN crew_workers temp_cw ON temp_cw.company_id = wla.company_id
      AND temp_cw.worker_id = wla.worker_id
      AND temp_cw.is_active = TRUE
      AND temp_cw.unassigned_at IS NULL
    LEFT JOIN work_crews temp_wc ON temp_wc.company_id = wla.company_id
      AND temp_wc.id = temp_cw.crew_id
      AND temp_wc.deleted_at IS NULL
    WHERE scoped_wl.id = wl.id
    GROUP BY scoped_wl.id, scoped_wl.company_id
  ) metrics ON TRUE
`;

async function getWorkLocations(companyId, filters = {}) {
  const includeInactive = shouldIncludeInactive(filters);

  const params = [companyId];
  const where = ['wl.company_id = $1', 'wl.deleted_at IS NULL'];
  if (!includeInactive) {
    where.push('COALESCE(wl.is_active, wl.status, TRUE) = TRUE');
  }
  const filterMap = [
    ['department_id', 'wl.geographic_department_id'],
    ['geographic_department_id', 'wl.geographic_department_id'],
    ['province_id', 'wl.geographic_province_id'],
    ['geographic_province_id', 'wl.geographic_province_id'],
    ['district_id', 'wl.geographic_district_id'],
    ['geographic_district_id', 'wl.geographic_district_id']
  ];
  for (const [key, column] of filterMap) {
    if (filters[key]) {
      params.push(filters[key]);
      where.push(`${column} = $${params.length}`);
    }
  }
  if (filters.is_active !== undefined) {
    params.push(filters.is_active === true || filters.is_active === 'true');
    where.push('COALESCE(wl.is_active, wl.status, TRUE) = $' + params.length);
  }

  const result = await query(
    `${WORK_LOCATION_CATALOG_SELECT}
     WHERE ${where.join(' AND ')}
     ORDER BY wl.name ASC`,
    params
  );
  return result.rows;
}

async function getWorkLocationById(id, companyId) {
  const result = await query(
    `${WORK_LOCATION_SELECT}
     WHERE wl.id = $1 AND wl.company_id = $2 AND wl.deleted_at IS NULL`,
    [id, companyId]
  );

  if (result.rowCount === 0) {
    throw createHttpError(404, 'WORK_LOCATION_NOT_FOUND', 'El lugar de trabajo no existe o no pertenece a la empresa.');
  }

  return result.rows[0];
}

async function assertUniqueName(companyId, name, excludedId = null) {
  const params = [companyId, name];
  let excludedSql = '';
  if (excludedId) {
    params.push(excludedId);
    excludedSql = `AND id != $${params.length}`;
  }

  const result = await query(
    `SELECT 1 FROM work_locations
     WHERE company_id = $1
       AND LOWER(name) = LOWER($2)
       AND deleted_at IS NULL
       ${excludedSql}`,
    params
  );

  if (result.rowCount > 0) {
    throw createHttpError(409, 'WORK_LOCATION_ALREADY_EXISTS', 'Ya existe un lugar de trabajo con ese nombre en la empresa.', [
      { field: 'name', message: 'Nombre de lugar de trabajo duplicado' }
    ]);
  }
}

async function createWorkLocation(companyId, data) {
  data = normalizePayload(data);
  await assertUniqueName(companyId, data.name);
  await validateGeography(
    { query },
    data.geographic_department_id,
    data.geographic_province_id,
    data.geographic_district_id
  );

  const workLocation = await insertReturning({ query }, 'work_locations', {
    company_id: companyId,
    sede_id: data.sede_id || null,
    name: data.name,
    description: data.description || null,
    address: data.address,
    geographic_department_id: data.geographic_department_id,
    geographic_province_id: data.geographic_province_id,
    geographic_district_id: data.geographic_district_id,
    latitude: data.latitude ?? null,
    longitude: data.longitude ?? null,
    allowed_radius_meters: data.allowed_radius_meters || 100,
    is_active: data.is_active !== false && data.status !== false,
    status: data.is_active !== false && data.status !== false
  });
  catalogCache.clear();
  return workLocation;
}

async function updateWorkLocation(id, companyId, data) {
  data = normalizePayload(data);
  const current = await getWorkLocationById(id, companyId);

  if (data.name && data.name.toLowerCase() !== current.name.toLowerCase()) {
    await assertUniqueName(companyId, data.name, id);
  }

  const geographicDepartmentId = data.geographic_department_id || current.geographic_department_id;
  const geographicProvinceId = data.geographic_province_id || current.geographic_province_id;
  const geographicDistrictId = data.geographic_district_id || current.geographic_district_id;

  if (data.geographic_department_id || data.geographic_province_id || data.geographic_district_id) {
    await validateGeography({ query }, geographicDepartmentId, geographicProvinceId, geographicDistrictId);
  }

  const updateData = { ...data, updated_at: new Date() };
  if (data.is_active !== undefined) updateData.status = data.is_active;
  if (data.status !== undefined) updateData.is_active = data.status;

  const workLocation = await updateReturning({ query }, 'work_locations', 'id', id, updateData);
  catalogCache.clear();
  return workLocation;
}

async function assertNoActiveWorkers(id, companyId) {
  const result = await query(
    `SELECT 1 FROM workers
     WHERE company_id = $1
       AND work_location_id = $2
       AND deleted_at IS NULL
       AND COALESCE(is_active, TRUE) = TRUE
     LIMIT 1`,
    [companyId, id]
  );

  if (result.rowCount > 0) {
    throw createHttpError(409, 'WORK_LOCATION_HAS_ACTIVE_WORKERS', 'No se puede desactivar este registro porque tiene trabajadores activos asociados.');
  }
}

async function updateWorkLocationStatus(id, companyId, isActive) {
  await getWorkLocationById(id, companyId);
  if (isActive === false) await assertNoActiveWorkers(id, companyId);

  const workLocation = await updateReturning({ query }, 'work_locations', 'id', id, {
    is_active: isActive,
    status: isActive,
    updated_at: new Date()
  });
  catalogCache.clear();
  return workLocation;
}

async function deleteWorkLocation(id, companyId, deletedBy = null) {
  await getWorkLocationById(id, companyId);
  await assertNoActiveWorkers(id, companyId);

  const workLocation = await updateReturning({ query }, 'work_locations', 'id', id, {
    is_active: false,
    status: false,
    deleted_at: new Date(),
    deleted_by: deletedBy,
    updated_at: new Date()
  });
  catalogCache.clear();
  return workLocation;
}

module.exports = {
  getWorkLocations,
  getWorkLocationById,
  createWorkLocation,
  updateWorkLocation,
  updateWorkLocationStatus,
  deleteWorkLocation
};
