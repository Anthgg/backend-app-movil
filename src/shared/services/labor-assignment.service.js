const { query } = require('../../config/database');
const { createHttpError } = require('../utils/http-error');

async function validateGeography(db, departmentId, provinceId, districtId) {
  const depRes = await db.query(
    `SELECT 1 FROM geographic_departments
     WHERE id = $1 AND deleted_at IS NULL AND COALESCE(status, TRUE) = TRUE`,
    [departmentId]
  );
  if (depRes.rowCount === 0) {
    throw createHttpError(422, 'GEOGRAPHIC_DEPARTMENT_NOT_FOUND', 'El departamento geográfico seleccionado no existe.');
  }

  const provRes = await db.query(
    `SELECT department_id FROM geographic_provinces
     WHERE id = $1 AND deleted_at IS NULL AND COALESCE(status, TRUE) = TRUE`,
    [provinceId]
  );
  if (provRes.rowCount === 0) {
    throw createHttpError(422, 'GEOGRAPHIC_PROVINCE_NOT_FOUND', 'La provincia seleccionada no existe.');
  }
  if (provRes.rows[0].department_id !== departmentId) {
    throw createHttpError(422, 'INVALID_PROVINCE_DEPARTMENT', 'La provincia seleccionada no pertenece al departamento indicado.');
  }

  const distRes = await db.query(
    `SELECT province_id FROM geographic_districts
     WHERE id = $1 AND deleted_at IS NULL AND COALESCE(status, TRUE) = TRUE`,
    [districtId]
  );
  if (distRes.rowCount === 0) {
    throw createHttpError(422, 'GEOGRAPHIC_DISTRICT_NOT_FOUND', 'El distrito seleccionado no existe.');
  }
  if (distRes.rows[0].province_id !== provinceId) {
    throw createHttpError(422, 'INVALID_DISTRICT_PROVINCE', 'El distrito seleccionado no pertenece a la provincia indicada.');
  }
}

async function validateLaborAssignment(db, data, companyId, options = {}) {
  const {
    requireDepartment = false,
    requireArea = false,
    requirePosition = false,
    requireWorkLocation = false
  } = options;

  const internalDepartmentId = data.internal_department_id;
  const areaId = data.area_id;
  const positionId = data.position_id || data.job_position_id;
  const workLocationId = data.work_location_id;

  if (requireDepartment && !internalDepartmentId) {
    throw createHttpError(422, 'VALIDATION_ERROR', 'El departamento interno es obligatorio.');
  }
  if (requireArea && !areaId) {
    throw createHttpError(422, 'VALIDATION_ERROR', 'El área de trabajo es obligatoria.');
  }
  if (requirePosition && !positionId) {
    throw createHttpError(422, 'VALIDATION_ERROR', 'El puesto seleccionado es obligatorio.');
  }
  if (requireWorkLocation && !workLocationId) {
    throw createHttpError(422, 'VALIDATION_ERROR', 'El lugar de trabajo es obligatorio.');
  }

  if (internalDepartmentId) {
    const depRes = await db.query(
      `SELECT 1 FROM departments
       WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL AND COALESCE(is_active, status, TRUE) = TRUE`,
      [internalDepartmentId, companyId]
    );
    if (depRes.rowCount === 0) {
      throw createHttpError(422, 'INVALID_INTERNAL_DEPARTMENT', 'El departamento interno no pertenece a la empresa.');
    }
  }

  if (areaId) {
    const areaRes = await db.query(
      `SELECT department_id FROM areas
       WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL AND COALESCE(is_active, status, TRUE) = TRUE`,
      [areaId, companyId]
    );
    if (areaRes.rowCount === 0) {
      throw createHttpError(422, 'INVALID_AREA', 'El área seleccionada no pertenece a la empresa.');
    }
    if (internalDepartmentId && areaRes.rows[0].department_id !== internalDepartmentId) {
      throw createHttpError(422, 'INVALID_AREA_DEPARTMENT', 'El área seleccionada no pertenece al departamento indicado.');
    }
  }

  let defaultRoleId = null;
  if (positionId) {
    const posRes = await db.query(
      `SELECT area_id, default_role_id FROM job_positions
       WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL AND COALESCE(is_active, status, TRUE) = TRUE`,
      [positionId, companyId]
    );
    if (posRes.rowCount === 0) {
      throw createHttpError(422, 'JOB_POSITION_NOT_FOUND', 'El puesto seleccionado no pertenece a la empresa.');
    }
    if (areaId && posRes.rows[0].area_id !== areaId) {
      throw createHttpError(422, 'INVALID_JOB_POSITION_AREA', 'El puesto seleccionado no pertenece al área indicada.');
    }
    defaultRoleId = posRes.rows[0].default_role_id;
  }

  if (workLocationId) {
    const locationRes = await db.query(
      `SELECT 1 FROM work_locations
       WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL AND COALESCE(is_active, status, TRUE) = TRUE`,
      [workLocationId, companyId]
    );
    if (locationRes.rowCount === 0) {
      throw createHttpError(422, 'INVALID_WORK_LOCATION_COMPANY', 'El lugar de trabajo no pertenece a la empresa del trabajador.');
    }
  }

  return { defaultRoleId, positionId };
}

async function assignDefaultRoleToUser(db, userId, roleId) {
  if (!userId || !roleId) return;
  await db.query(
    'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [userId, roleId]
  );
}

async function updateWorkerLaborAssignment(workerId, companyId, data) {
  const workerRes = await query(
    `SELECT id, user_id, company_id, sede_id, internal_department_id, area_id,
            COALESCE(position_id, job_position_id) AS position_id, work_location_id
     FROM workers
     WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
    [workerId, companyId]
  );

  if (workerRes.rowCount === 0) {
    throw createHttpError(404, 'WORKER_NOT_FOUND', 'Trabajador no encontrado.');
  }

  const worker = workerRes.rows[0];
  const merged = {
    sede_id: data.sede_id !== undefined ? data.sede_id : worker.sede_id,
    internal_department_id: data.internal_department_id !== undefined ? data.internal_department_id : worker.internal_department_id,
    area_id: data.area_id !== undefined ? data.area_id : worker.area_id,
    position_id: data.position_id !== undefined || data.job_position_id !== undefined
      ? (data.position_id || data.job_position_id)
      : worker.position_id,
    work_location_id: data.work_location_id !== undefined ? data.work_location_id : worker.work_location_id
  };
  const { defaultRoleId, positionId } = await validateLaborAssignment({ query }, merged, companyId);

  const result = await query(
    `UPDATE workers
     SET sede_id = COALESCE($1, sede_id),
         internal_department_id = COALESCE($2, internal_department_id),
         area_id = COALESCE($3, area_id),
         position_id = COALESCE($4, position_id),
         job_position_id = COALESCE($4, job_position_id),
         work_location_id = COALESCE($5, work_location_id),
         updated_at = NOW()
     WHERE id = $6 AND company_id = $7
     RETURNING *`,
    [
      merged.sede_id || null,
      merged.internal_department_id || null,
      merged.area_id || null,
      positionId || null,
      merged.work_location_id || null,
      workerId,
      companyId
    ]
  );

  await assignDefaultRoleToUser({ query }, worker.user_id, defaultRoleId);

  return result.rows[0];
}

module.exports = {
  validateGeography,
  validateLaborAssignment,
  assignDefaultRoleToUser,
  updateWorkerLaborAssignment
};
