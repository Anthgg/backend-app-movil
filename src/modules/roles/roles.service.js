const { query, withTransaction } = require('../../config/database');

const PROTECTED_ROLE_CODES = new Set(['ADMIN', 'RRHH', 'TRABAJADOR']);
const ACCESS_LEVELS = ['none', 'read', 'write', 'admin'];
const MODULE_ALIASES = {
  positions: 'job_positions',
  jobPositions: 'job_positions',
  'job-positions': 'job_positions',
  workLocations: 'work_locations',
  'work-locations': 'work_locations'
};

function shouldIncludeInactive(filters = {}) {
  return filters.include_inactive === true
    || filters.include_inactive === 'true'
    || filters.status === 'all';
}

function createHttpError(statusCode, errorCode, message, errors = undefined, details = undefined) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.errorCode = errorCode;
  if (errors) error.errors = errors;
  if (details) error.details = details;
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

function normalizeModuleKey(value) {
  const raw = String(value || '').trim();
  return MODULE_ALIASES[raw] || raw.replace(/-/g, '_');
}

function getRoleCodeFromPayload(data) {
  return normalizeRoleCode(data.role || data.role_key || data.code || data.label || data.name);
}

function getRoleNameFromPayload(data) {
  return (data.label || data.name || '').trim();
}

function isProtectedRole(role) {
  return role.is_system_role === true || PROTECTED_ROLE_CODES.has(normalizeRoleCode(role.code || role.name));
}

function assertCanManageRoles(req) {
  const roles = req.user?.roles || [];
  const permissions = req.user?.permissions || [];
  if (roles.includes('ADMIN') || permissions.includes('roles.admin')) return;
  throw createHttpError(403, 'ROLE_MANAGEMENT_FORBIDDEN', 'No tienes permiso para administrar roles.');
}

function assertCanModifyRole(role) {
  if (isProtectedRole(role)) {
    throw createHttpError(403, 'SYSTEM_ROLE_FORBIDDEN', 'No se pueden modificar, desactivar ni eliminar roles protegidos del sistema.');
  }
}

async function ensureUniqueRole(companyId, code, name, excludeId = null, db = { query }) {
  const params = [companyId, code, name];
  let excludeSql = '';

  if (excludeId) {
    params.push(excludeId);
    excludeSql = `AND id != $${params.length}`;
  }

  const existsRes = await db.query(
    `SELECT 1
     FROM roles
     WHERE deleted_at IS NULL
       AND (company_id = $1 OR company_id IS NULL)
       AND (LOWER(COALESCE(code, name)) = LOWER($2) OR LOWER(name) = LOWER($3))
       ${excludeSql}
     LIMIT 1`,
    params
  );

  if (existsRes.rowCount > 0) {
    throw createHttpError(409, 'ROLE_ALREADY_EXISTS', 'Ya existe un rol con ese identificador o nombre.', [
      { field: 'role', message: 'Rol duplicado' }
    ]);
  }
}

async function getAllowedModules(db = { query }) {
  const res = await db.query(
    `SELECT DISTINCT split_part(name, '.', 1) AS module_key
     FROM permissions
     WHERE name LIKE '%.%'
     ORDER BY module_key`
  );
  return new Set(res.rows.map((row) => row.module_key));
}

async function getPermissionsForModule(moduleKey, access, db = { query }) {
  if (access === 'none') return [];

  const res = await db.query(
    `SELECT id, name
     FROM permissions
     WHERE name = $1
        OR name LIKE $2
     ORDER BY name`,
    [`${moduleKey}.read`, `${moduleKey}.%`]
  );

  const permissions = res.rows;
  if (access === 'admin') return permissions;

  const readPermissions = permissions.filter((permission) => {
    const action = permission.name.split('.').pop();
    return action === 'read' || action === 'read_own' || action === 'read_company' || action === 'read_project';
  });

  if (access === 'read') return readPermissions;

  const writeActions = new Set([
    'approve', 'check_in', 'check_out', 'correct', 'create', 'export', 'generate',
    'manage', 'reject', 'request', 'review', 'update', 'upload_signed', 'write'
  ]);

  return permissions.filter((permission) => {
    const action = permission.name.split('.').pop();
    return readPermissions.some((readPermission) => readPermission.id === permission.id) || writeActions.has(action);
  });
}

async function validateModules(modules = [], db = { query }) {
  const allowedModules = await getAllowedModules(db);
  const normalized = [];
  const seen = new Set();

  for (const moduleConfig of modules) {
    const key = normalizeModuleKey(moduleConfig.key);
    if (!allowedModules.has(key)) {
      throw createHttpError(422, 'INVALID_ROLE_MODULE', 'El modulo enviado no existe o no esta permitido.', [
        { field: 'modules', message: `Modulo no permitido: ${moduleConfig.key}` }
      ]);
    }

    if (!ACCESS_LEVELS.includes(moduleConfig.access)) {
      throw createHttpError(422, 'INVALID_ROLE_ACCESS', 'Nivel de acceso invalido.', [
        { field: 'modules.access', message: `Acceso no permitido: ${moduleConfig.access}` }
      ]);
    }

    if (!seen.has(key)) {
      normalized.push({ key, access: moduleConfig.access });
      seen.add(key);
    }
  }

  return normalized;
}

async function syncRoleModules(roleId, modules = [], db = { query }) {
  const normalizedModules = await validateModules(modules, db);
  const moduleKeys = normalizedModules.map((moduleConfig) => moduleConfig.key);

  if (moduleKeys.length > 0) {
    await db.query(
      `DELETE FROM role_permissions rp
       USING permissions p
       WHERE rp.permission_id = p.id
         AND rp.role_id = $1
         AND split_part(p.name, '.', 1) = ANY($2::text[])`,
      [roleId, moduleKeys]
    );
  }

  const permissionIds = [];
  for (const moduleConfig of normalizedModules) {
    const permissions = await getPermissionsForModule(moduleConfig.key, moduleConfig.access, db);
    permissionIds.push(...permissions.map((permission) => permission.id));
  }

  if (permissionIds.length > 0) {
    await db.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, unnest($2::uuid[])
       ON CONFLICT DO NOTHING`,
      [roleId, permissionIds]
    );
  }
}

function inferModuleAccess(modulePermissions, totalModulePermissions) {
  if (modulePermissions.length === 0) return 'none';
  if (modulePermissions.length >= totalModulePermissions) return 'admin';

  const hasWritePermission = modulePermissions.some((permission) => {
    const action = permission.name.split('.').pop();
    return !['read', 'read_own', 'read_company', 'read_project'].includes(action);
  });

  return hasWritePermission ? 'write' : 'read';
}

function mapRole(row, permissions = [], permissionCounts = new Map()) {
  const modulesByKey = new Map();
  permissions.forEach((permission) => {
    if (!permission.name.includes('.')) return;
    const key = permission.name.split('.')[0];
    if (!modulesByKey.has(key)) modulesByKey.set(key, []);
    modulesByKey.get(key).push(permission);
  });

  const modules = Array.from(modulesByKey.entries())
    .map(([key, modulePermissions]) => ({
      key,
      access: inferModuleAccess(modulePermissions, permissionCounts.get(key) || modulePermissions.length)
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const code = normalizeRoleCode(row.code || row.name) || `ROLE_${row.id}`;
  return {
    id: row.id,
    role: code.toLowerCase(),
    role_key: code,
    code,
    label: row.name,
    name: row.name,
    description: row.description,
    is_active: row.is_active,
    is_system_role: row.is_system_role,
    protected: isProtectedRole(row),
    company_id: row.company_id,
    modules,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

async function getPermissionCounts(db = { query }) {
  const res = await db.query(
    `SELECT split_part(name, '.', 1) AS module_key, COUNT(*)::int AS total
     FROM permissions
     WHERE name LIKE '%.%'
     GROUP BY module_key`
  );
  return new Map(res.rows.map((row) => [row.module_key, row.total]));
}

async function getRolePermissions(roleIds, db = { query }) {
  if (roleIds.length === 0) return new Map();

  const res = await db.query(
    `SELECT rp.role_id, p.id, p.name
     FROM role_permissions rp
     JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = ANY($1::uuid[])
     ORDER BY p.name`,
    [roleIds]
  );

  const permissionsByRole = new Map();
  res.rows.forEach((row) => {
    if (!permissionsByRole.has(row.role_id)) permissionsByRole.set(row.role_id, []);
    permissionsByRole.get(row.role_id).push({ id: row.id, name: row.name });
  });
  return permissionsByRole;
}

async function getRoles(companyId, filters = {}) {
  const includeInactive = shouldIncludeInactive(filters);
  const activeSql = includeInactive ? '' : 'AND COALESCE(is_active, TRUE) = TRUE';

  const res = await query(
    `SELECT id, company_id, name, code, description, COALESCE(is_system_role, FALSE) AS is_system_role,
            COALESCE(is_active, TRUE) AS is_active, created_at, updated_at
     FROM roles
     WHERE deleted_at IS NULL
       AND (company_id = $1 OR company_id IS NULL)
       ${activeSql}
     ORDER BY CASE WHEN company_id = $1 THEN 0 ELSE 1 END, name ASC`,
    [companyId]
  );

  const uniqueRowsByCode = new Map();
  for (const row of res.rows) {
    const code = normalizeRoleCode(row.code || row.name) || `ROLE_${row.id}`;
    if (!uniqueRowsByCode.has(code)) {
      uniqueRowsByCode.set(code, row);
    }
  }
  const uniqueRows = Array.from(uniqueRowsByCode.values());

  const permissionCounts = await getPermissionCounts();
  const permissionsByRole = await getRolePermissions(uniqueRows.map((row) => row.id));
  return uniqueRows.map((row) => mapRole(row, permissionsByRole.get(row.id) || [], permissionCounts));
}

async function getRoleById(id, companyId, db = { query }) {
  const res = await db.query(
    `SELECT id, company_id, name, code, description, COALESCE(is_system_role, FALSE) AS is_system_role,
            COALESCE(is_active, TRUE) AS is_active, created_at, updated_at
     FROM roles
     WHERE id = $1
       AND deleted_at IS NULL
       AND (company_id = $2 OR company_id IS NULL)`,
    [id, companyId]
  );

  if (res.rowCount === 0) {
    throw createHttpError(404, 'ROLE_NOT_FOUND', 'El rol no existe o no pertenece a la empresa.');
  }

  const permissionCounts = await getPermissionCounts(db);
  const permissionsByRole = await getRolePermissions([id], db);
  return mapRole(res.rows[0], permissionsByRole.get(id) || [], permissionCounts);
}

async function createRole(companyId, data, req) {
  assertCanManageRoles(req);

  const code = getRoleCodeFromPayload(data);
  const name = getRoleNameFromPayload(data);

  return withTransaction(async (client) => {
    await ensureUniqueRole(companyId, code, name, null, client);
    await validateModules(data.modules || [], client);

    const roleRes = await client.query(
      `INSERT INTO roles (company_id, name, code, description, is_system_role, is_active)
       VALUES ($1, $2, $3, $4, FALSE, $5)
       RETURNING id`,
      [companyId, name, code, data.description || null, data.is_active !== false]
    );

    const roleId = roleRes.rows[0].id;
    if (data.modules) await syncRoleModules(roleId, data.modules, client);

    return getRoleById(roleId, companyId, client);
  });
}

async function updateRole(id, companyId, data, req) {
  assertCanManageRoles(req);

  return withTransaction(async (client) => {
    const current = await getRoleById(id, companyId, client);
    assertCanModifyRole(current);

    const nextCode = data.role || data.role_key || data.code
      ? getRoleCodeFromPayload(data)
      : current.code;
    const nextName = data.label || data.name
      ? getRoleNameFromPayload(data)
      : current.name;

    if (nextCode !== current.code || nextName !== current.name) {
      await ensureUniqueRole(companyId, nextCode, nextName, id, client);
    }

    const updateFields = [];
    const params = [];

    if (data.role || data.role_key || data.code) {
      params.push(nextCode);
      updateFields.push(`code = $${params.length}`);
    }
    if (data.label || data.name) {
      params.push(nextName);
      updateFields.push(`name = $${params.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'description')) {
      params.push(data.description || null);
      updateFields.push(`description = $${params.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'is_active')) {
      params.push(data.is_active);
      updateFields.push(`is_active = $${params.length}`);
    }

    if (updateFields.length > 0) {
      params.push(id);
      await client.query(
        `UPDATE roles
         SET ${updateFields.join(', ')}, updated_at = NOW()
         WHERE id = $${params.length}`,
        params
      );
    }

    if (data.modules) await syncRoleModules(id, data.modules, client);

    return getRoleById(id, companyId, client);
  });
}

async function updateRoleStatus(id, companyId, isActive, req) {
  assertCanManageRoles(req);

  return withTransaction(async (client) => {
    const role = await getRoleById(id, companyId, client);
    assertCanModifyRole(role);

    await client.query(
      `UPDATE roles
       SET is_active = $1, updated_at = NOW()
       WHERE id = $2`,
      [isActive, id]
    );

    return getRoleById(id, companyId, client);
  });
}

async function deleteRole(id, companyId, deletedBy = null, req) {
  assertCanManageRoles(req);

  return withTransaction(async (client) => {
    const role = await getRoleById(id, companyId, client);
    assertCanModifyRole(role);

    await client.query(
      `UPDATE roles
       SET deleted_at = NOW(), deleted_by = $1, is_active = FALSE, updated_at = NOW()
       WHERE id = $2`,
      [deletedBy, id]
    );

    return {
      ...role,
      is_active: false
    };
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
