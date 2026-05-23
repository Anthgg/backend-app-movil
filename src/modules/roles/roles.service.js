const { query } = require('../../config/database');
const { insertReturning, updateReturning } = require('../../utils/db.util');

const CRITICAL_ROLE_CODES = new Set(['ADMIN', 'GERENCIA']);

function createHttpError(statusCode, errorCode, message, errors = undefined) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.errorCode = errorCode;
  if (errors) error.errors = errors;
  return error;
}

function normalizeRoleCode(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function assertCanManageRole(req, roleCode) {
  const roles = req.user?.roles || [];
  if (roles.includes('ADMIN')) return;

  if (CRITICAL_ROLE_CODES.has(normalizeRoleCode(roleCode))) {
    throw createHttpError(403, 'ROLE_ASSIGNMENT_FORBIDDEN', 'No tienes permiso para administrar roles criticos.');
  }
}

async function ensureUniqueRole(companyId, data, excludeId = null) {
  const code = normalizeRoleCode(data.code || data.name);
  const params = [companyId, data.name, code];
  let excludeSql = '';

  if (excludeId) {
    params.push(excludeId);
    excludeSql = `AND id != $${params.length}`;
  }

  const existsRes = await query(
    `SELECT 1
     FROM roles
     WHERE deleted_at IS NULL
       AND (company_id = $1 OR company_id IS NULL)
       AND (LOWER(name) = LOWER($2) OR LOWER(code) = LOWER($3))
       ${excludeSql}
     LIMIT 1`,
    params
  );

  if (existsRes.rowCount > 0) {
    throw createHttpError(409, 'ROLE_ALREADY_EXISTS', 'Ya existe un rol con ese nombre o codigo.', [
      { field: 'name', message: 'Rol duplicado' }
    ]);
  }

  return code;
}

async function getRoles(companyId) {
  const res = await query(
    `SELECT id, company_id, name, code, description, is_system_role, COALESCE(is_active, TRUE) AS is_active, created_at, updated_at
     FROM roles
     WHERE deleted_at IS NULL
       AND (company_id = $1 OR company_id IS NULL)
     ORDER BY CASE WHEN company_id = $1 THEN 0 ELSE 1 END, name ASC`,
    [companyId]
  );
  return res.rows;
}

async function getRoleById(id, companyId) {
  const res = await query(
    `SELECT id, company_id, name, code, description, is_system_role, COALESCE(is_active, TRUE) AS is_active, created_at, updated_at
     FROM roles
     WHERE id = $1
       AND deleted_at IS NULL
       AND (company_id = $2 OR company_id IS NULL)`,
    [id, companyId]
  );

  if (res.rowCount === 0) {
    throw createHttpError(404, 'ROLE_NOT_FOUND', 'El rol no existe o no pertenece a la empresa.');
  }

  return res.rows[0];
}

async function createRole(companyId, data, req) {
  const code = await ensureUniqueRole(companyId, data);
  assertCanManageRole(req, code);

  return insertReturning({ query }, 'roles', {
    company_id: companyId,
    name: data.name.trim(),
    code,
    description: data.description || null,
    is_system_role: data.is_system_role === true,
    is_active: data.is_active !== false
  });
}

async function updateRole(id, companyId, data, req) {
  const role = await getRoleById(id, companyId);
  assertCanManageRole(req, data.code || role.code || role.name);

  const updateData = {
    ...data,
    updated_at: new Date()
  };

  if (data.name || data.code) {
    updateData.code = await ensureUniqueRole(companyId, {
      name: data.name || role.name,
      code: data.code || role.code
    }, id);
  }

  if (role.company_id === null && !req.user?.roles?.includes('ADMIN')) {
    throw createHttpError(403, 'SYSTEM_ROLE_FORBIDDEN', 'No tienes permiso para modificar roles globales.');
  }

  return updateReturning({ query }, 'roles', 'id', id, updateData);
}

async function updateRoleStatus(id, companyId, isActive, req) {
  const role = await getRoleById(id, companyId);
  assertCanManageRole(req, role.code || role.name);

  return updateReturning({ query }, 'roles', 'id', id, {
    is_active: isActive,
    updated_at: new Date()
  });
}

async function deleteRole(id, companyId, deletedBy = null, req) {
  const role = await getRoleById(id, companyId);
  assertCanManageRole(req, role.code || role.name);

  const activeUsers = await query(
    `SELECT 1
     FROM user_roles ur
     JOIN users u ON u.id = ur.user_id
     WHERE ur.role_id = $1
       AND u.company_id = $2
       AND u.deleted_at IS NULL
       AND COALESCE(u.is_active, TRUE) = TRUE
     LIMIT 1`,
    [id, companyId]
  );

  if (activeUsers.rowCount > 0) {
    throw createHttpError(409, 'ROLE_HAS_ACTIVE_USERS', 'No se puede eliminar un rol con usuarios activos asociados.');
  }

  return updateReturning({ query }, 'roles', 'id', id, {
    deleted_at: new Date(),
    deleted_by: deletedBy,
    is_active: false,
    updated_at: new Date()
  });
}

module.exports = {
  getRoles,
  getRoleById,
  createRole,
  updateRole,
  updateRoleStatus,
  deleteRole,
  normalizeRoleCode
};
