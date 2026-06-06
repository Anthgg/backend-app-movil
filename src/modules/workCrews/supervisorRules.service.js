const { query } = require('../../config/database');
const { createHttpError } = require('../../shared/utils/http-error');
const { isValidUUID } = require('../../utils/uuid.util');

const DEFAULT_COMPANY_RULES = {
  max_crews_per_supervisor: 2,
  exceed_action: 'block',
  allowed_roles_for_supervisor: ['supervisor']
};

const WORK_CREW_ERROR_CODES = {
  INVALID_SUPERVISOR_ID: 'INVALID_SUPERVISOR_ID',
  SUPERVISOR_NOT_FOUND: 'SUPERVISOR_NOT_FOUND',
  SUPERVISOR_ROLE_NOT_ALLOWED: 'SUPERVISOR_ROLE_NOT_ALLOWED',
  SUPERVISOR_CREWS_LIMIT_EXCEEDED: 'SUPERVISOR_CREWS_LIMIT_EXCEEDED',
  SUPERVISOR_CREWS_LIMIT_WARNING: 'SUPERVISOR_CREWS_LIMIT_WARNING',
  COMPANY_RULES_INVALID: 'COMPANY_RULES_INVALID'
};

function getDb(dbClient = null) {
  return dbClient || { query };
}

function normalizeAllowedRoles(value) {
  if (Array.isArray(value)) {
    return value.map(String).map((role) => role.trim().toLowerCase()).filter(Boolean);
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return normalizeAllowedRoles(parsed);
      }
    } catch {
      return value.split(',').map((role) => role.trim().toLowerCase()).filter(Boolean);
    }
  }

  return [...DEFAULT_COMPANY_RULES.allowed_roles_for_supervisor];
}

function normalizeRules(row = null) {
  if (!row) {
    return { ...DEFAULT_COMPANY_RULES };
  }

  const maxCrews = Number(row.max_crews_per_supervisor);
  const exceedAction = String(row.exceed_action || DEFAULT_COMPANY_RULES.exceed_action).toLowerCase();

  if (!Number.isFinite(maxCrews) || maxCrews < 1 || !['block', 'warn'].includes(exceedAction)) {
    throw createHttpError(
      500,
      WORK_CREW_ERROR_CODES.COMPANY_RULES_INVALID,
      'La configuracion de reglas de cuadrilla de la empresa es invalida.'
    );
  }

  const allowedRoles = normalizeAllowedRoles(row.allowed_roles_for_supervisor);
  return {
    max_crews_per_supervisor: maxCrews,
    exceed_action: exceedAction,
    allowed_roles_for_supervisor: allowedRoles.length > 0
      ? allowedRoles
      : [...DEFAULT_COMPANY_RULES.allowed_roles_for_supervisor]
  };
}

function assertSupervisorId(supervisorId) {
  if (!isValidUUID(supervisorId)) {
    throw createHttpError(400, WORK_CREW_ERROR_CODES.INVALID_SUPERVISOR_ID, 'supervisor_id invalido. Debe ser un UUID valido.', [
      { field: 'supervisor_id', message: 'supervisor_id invalido. Debe ser un UUID valido.' }
    ]);
  }
}

function normalizeSupervisorRoles(supervisor) {
  const values = [
    supervisor.role_code,
    supervisor.role_name,
    ...(Array.isArray(supervisor.role_codes) ? supervisor.role_codes : []),
    ...(Array.isArray(supervisor.role_names) ? supervisor.role_names : [])
  ];

  return [...new Set(
    values
      .map((role) => String(role || '').trim().toLowerCase())
      .filter(Boolean)
  )];
}

async function getCompanySupervisorRules(companyId, dbClient = null) {
  const db = getDb(dbClient);

  try {
    const result = await db.query(
      `SELECT max_crews_per_supervisor,
              exceed_action,
              allowed_roles_for_supervisor
       FROM company_rules
       WHERE company_id = $1
       LIMIT 1`,
      [companyId]
    );

    return normalizeRules(result.rows[0] || null);
  } catch (error) {
    if (error.code === '42P01') {
      return { ...DEFAULT_COMPANY_RULES };
    }
    throw error;
  }
}

async function findSupervisor(supervisorId, companyId, dbClient = null) {
  const db = getDb(dbClient);
  assertSupervisorId(supervisorId);

  const result = await db.query(
    `SELECT u.id AS user_id,
            u.company_id,
            COALESCE(role_data.role_codes, ARRAY[]::text[]) AS role_codes,
            COALESCE(role_data.role_names, ARRAY[]::text[]) AS role_names
     FROM users u
     LEFT JOIN LATERAL (
       SELECT ARRAY_AGG(DISTINCT LOWER(COALESCE(r.code, r.name)))
                FILTER (WHERE COALESCE(r.code, r.name) IS NOT NULL) AS role_codes,
              ARRAY_AGG(DISTINCT LOWER(COALESCE(r.name, r.code)))
                FILTER (WHERE COALESCE(r.name, r.code) IS NOT NULL) AS role_names
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = u.id
         AND r.deleted_at IS NULL
         AND (r.company_id = $2 OR r.company_id IS NULL)
       ORDER BY CASE WHEN r.company_id = $2 THEN 0 ELSE 1 END,
                r.created_at ASC NULLS LAST
       LIMIT 1
     ) role_data ON TRUE
     WHERE u.id = $1
       AND u.company_id = $2
       AND u.deleted_at IS NULL
       AND COALESCE(u.is_active, TRUE) = TRUE
       AND COALESCE(u.status, 'active') = 'active'
     LIMIT 1`,
    [supervisorId, companyId]
  );

  if (result.rowCount === 0) {
    throw createHttpError(404, WORK_CREW_ERROR_CODES.SUPERVISOR_NOT_FOUND, 'No se encontro el supervisor indicado.');
  }

  return result.rows[0];
}

async function validateSupervisorRole({ supervisorId, companyId, rules, dbClient = null }) {
  const resolvedRules = rules || await getCompanySupervisorRules(companyId, dbClient);
  const supervisor = await findSupervisor(supervisorId, companyId, dbClient);
  const allowedRoles = normalizeAllowedRoles(resolvedRules.allowed_roles_for_supervisor);
  const supervisorRoles = normalizeSupervisorRoles(supervisor);
  const currentRole = supervisorRoles.find((role) => allowedRoles.includes(role)) || supervisorRoles[0] || null;

  if (!currentRole || !allowedRoles.includes(currentRole)) {
    throw createHttpError(
      422,
      WORK_CREW_ERROR_CODES.SUPERVISOR_ROLE_NOT_ALLOWED,
      'El usuario seleccionado no tiene un rol permitido para supervisar cuadrillas.',
      undefined,
      {
        allowedRoles,
        currentRole,
        currentRoles: supervisorRoles
      }
    );
  }

  return supervisor;
}

async function countActiveCrewsBySupervisor({ supervisorId, companyId, excludeCrewId = null, dbClient = null }) {
  const db = getDb(dbClient);
  const params = [supervisorId, companyId];
  const excludeSql = excludeCrewId ? 'AND id <> $3' : '';
  if (excludeCrewId) {
    params.push(excludeCrewId);
  }

  const result = await db.query(
    `SELECT COUNT(*)::int AS total
     FROM work_crews
     WHERE supervisor_id = $1
       AND company_id = $2
       AND deleted_at IS NULL
       AND COALESCE(is_active, status, TRUE) = TRUE
       ${excludeSql}`,
    params
  );

  return Number(result.rows[0]?.total || 0);
}

async function validateSupervisorCrewLimit({
  supervisorId,
  companyId,
  excludeCrewId = null,
  rules,
  dbClient = null
}) {
  const resolvedRules = rules || await getCompanySupervisorRules(companyId, dbClient);
  const maxCrews = Number(resolvedRules.max_crews_per_supervisor);
  if (maxCrews >= 999) {
    return { warnings: [] };
  }

  const currentCrews = await countActiveCrewsBySupervisor({
    supervisorId,
    companyId,
    excludeCrewId,
    dbClient
  });

  if (currentCrews < maxCrews) {
    return { warnings: [] };
  }

  const details = {
    supervisorId,
    currentCrews,
    maxCrews
  };

  if (resolvedRules.exceed_action === 'warn') {
    return {
      warnings: [
        {
          code: WORK_CREW_ERROR_CODES.SUPERVISOR_CREWS_LIMIT_WARNING,
          message: 'El supervisor supera el limite recomendado de cuadrillas.',
          details
        }
      ]
    };
  }

  throw createHttpError(
    422,
    WORK_CREW_ERROR_CODES.SUPERVISOR_CREWS_LIMIT_EXCEEDED,
    'El supervisor ya tiene el maximo de cuadrillas permitidas.',
    undefined,
    details
  );
}

async function validateSupervisorAssignment({
  supervisorId,
  companyId,
  excludeCrewId = null,
  dbClient = null
}) {
  const rules = await getCompanySupervisorRules(companyId, dbClient);
  const supervisor = await validateSupervisorRole({ supervisorId, companyId, rules, dbClient });
  const limitResult = await validateSupervisorCrewLimit({
    supervisorId,
    companyId,
    excludeCrewId,
    rules,
    dbClient
  });

  return {
    supervisor,
    rules,
    warnings: limitResult.warnings || []
  };
}

module.exports = {
  DEFAULT_COMPANY_RULES,
  WORK_CREW_ERROR_CODES,
  normalizeAllowedRoles,
  getCompanySupervisorRules,
  validateSupervisorRole,
  countActiveCrewsBySupervisor,
  validateSupervisorCrewLimit,
  validateSupervisorAssignment
};
