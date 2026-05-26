const { query } = require('../../config/database');
const { insertReturning, updateReturning } = require('../../utils/db.util');
const { createHttpError } = require('../../shared/utils/http-error');

const DEPARTMENT_SELECT = `
  SELECT id, company_id, name, description,
         COALESCE(is_active, status, TRUE) AS is_active,
         status, created_at, updated_at
  FROM departments
`;

async function getDepartments(companyId) {
  const result = await query(
    `${DEPARTMENT_SELECT}
     WHERE company_id = $1
       AND deleted_at IS NULL
       AND COALESCE(is_active, status, TRUE) = TRUE
     ORDER BY name ASC`,
    [companyId]
  );
  return result.rows;
}

async function getDepartmentById(id, companyId) {
  const result = await query(
    `${DEPARTMENT_SELECT}
     WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
    [id, companyId]
  );

  if (result.rowCount === 0) {
    throw createHttpError(404, 'DEPARTMENT_NOT_FOUND', 'El departamento no existe o no pertenece a la empresa.');
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
    `SELECT 1 FROM departments
     WHERE company_id = $1
       AND LOWER(name) = LOWER($2)
       AND deleted_at IS NULL
       ${excludedSql}`,
    params
  );

  if (result.rowCount > 0) {
    throw createHttpError(409, 'DEPARTMENT_ALREADY_EXISTS', 'Ya existe un departamento con ese nombre en la empresa.', [
      { field: 'name', message: 'Nombre de departamento duplicado' }
    ]);
  }
}

async function createDepartment(companyId, data) {
  await assertUniqueName(companyId, data.name);

  return insertReturning({ query }, 'departments', {
    company_id: companyId,
    name: data.name,
    description: data.description || null,
    is_active: data.is_active !== false && data.status !== false,
    status: data.is_active !== false && data.status !== false
  });
}

async function updateDepartment(id, companyId, data) {
  const department = await getDepartmentById(id, companyId);

  if (data.name && data.name.toLowerCase() !== department.name.toLowerCase()) {
    await assertUniqueName(companyId, data.name, id);
  }

  const updateData = { ...data, updated_at: new Date() };
  if (data.is_active !== undefined) updateData.status = data.is_active;
  if (data.status !== undefined) updateData.is_active = data.status;

  return updateReturning({ query }, 'departments', 'id', id, updateData);
}

async function assertNoActiveWorkers(id, companyId) {
  const result = await query(
    `SELECT 1 FROM workers
     WHERE company_id = $1
       AND internal_department_id = $2
       AND deleted_at IS NULL
       AND COALESCE(is_active, TRUE) = TRUE
     LIMIT 1`,
    [companyId, id]
  );

  if (result.rowCount > 0) {
    throw createHttpError(409, 'DEPARTMENT_HAS_ACTIVE_WORKERS', 'No se puede desactivar este registro porque tiene trabajadores activos asociados.');
  }
}

async function updateDepartmentStatus(id, companyId, isActive) {
  await getDepartmentById(id, companyId);
  if (isActive === false) await assertNoActiveWorkers(id, companyId);

  return updateReturning({ query }, 'departments', 'id', id, {
    is_active: isActive,
    status: isActive,
    updated_at: new Date()
  });
}

async function deleteDepartment(id, companyId, deletedBy = null) {
  await getDepartmentById(id, companyId);
  await assertNoActiveWorkers(id, companyId);

  return updateReturning({ query }, 'departments', 'id', id, {
    is_active: false,
    status: false,
    deleted_at: new Date(),
    deleted_by: deletedBy,
    updated_at: new Date()
  });
}

module.exports = {
  getDepartments,
  getDepartmentById,
  createDepartment,
  updateDepartment,
  updateDepartmentStatus,
  deleteDepartment
};
