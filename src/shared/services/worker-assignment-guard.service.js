const { query } = require('../../config/database');
const { createHttpError } = require('../utils/http-error');
const { isValidUUID } = require('../../utils/uuid.util');
const { tableHasColumn } = require('../../utils/db.util');

const WORKER_ASSIGNMENT_ERROR_CODES = {
  INVALID_WORKER_ID: 'INVALID_WORKER_ID',
  WORKER_NOT_FOUND: 'WORKER_NOT_FOUND',
  WORKER_ALREADY_ASSIGNED: 'WORKER_ALREADY_ASSIGNED',
  WORKER_ALREADY_IN_CREW: 'WORKER_ALREADY_IN_CREW',
  WORKER_REASSIGN_FORBIDDEN: 'WORKER_REASSIGN_FORBIDDEN',
  WORKER_ASSIGNMENT_CONFLICT: 'WORKER_ASSIGNMENT_CONFLICT',
  WORKER_FORBIDDEN: 'WORKER_FORBIDDEN'
};

const REASSIGN_PERMISSIONS = new Set([
  'workers.reassign',
  'crews.manage',
  'projects.manage',
  'admin'
]);

function getDb(dbClient = null) {
  return dbClient || { query };
}

function normalizeId(value) {
  return value === undefined ? null : value;
}

function assertWorkerId(workerId) {
  if (!isValidUUID(workerId)) {
    throw createHttpError(400, WORKER_ASSIGNMENT_ERROR_CODES.INVALID_WORKER_ID, 'workerId invalido. Debe ser un UUID valido.', [
      { field: 'workerId', message: 'workerId invalido. Debe ser un UUID valido.' }
    ]);
  }
}

function assertOptionalUuid(value, field, errorCode) {
  if (value && !isValidUUID(value)) {
    throw createHttpError(400, errorCode, `${field} invalido. Debe ser un UUID valido.`, [
      { field, message: `${field} invalido. Debe ser un UUID valido.` }
    ]);
  }
}

function normalizeRoles(user = {}) {
  return (user.roles || []).map((role) => String(role).trim().toUpperCase()).filter(Boolean);
}

function normalizePermissions(user = {}) {
  return (user.permissions || []).map((permission) => String(permission).trim().toLowerCase()).filter(Boolean);
}

function isAdminLike(user = {}) {
  const roles = normalizeRoles(user);
  return roles.includes('ADMIN') || roles.includes('SUPER_ADMIN') || roles.includes('RRHH');
}

function hasReassignPermission(user = {}) {
  if (isAdminLike(user)) return true;
  return normalizePermissions(user).some((permission) => REASSIGN_PERMISSIONS.has(permission));
}

function isSameId(left, right) {
  if (!left || !right) return false;
  return String(left).toLowerCase() === String(right).toLowerCase();
}

async function hasWorkerColumn(columnName, dbClient = null) {
  try {
    return await tableHasColumn('workers', columnName, getDb(dbClient));
  } catch {
    return false;
  }
}

async function getWorkerBase(workerId, companyId, dbClient = null) {
  const db = getDb(dbClient);
  const hasProjectId = await hasWorkerColumn('project_id', db);
  const hasSupervisorId = await hasWorkerColumn('supervisor_id', db);
  const result = await db.query(
    `SELECT w.id,
            w.company_id,
            w.user_id,
            w.work_location_id,
            ${hasProjectId ? 'w.project_id' : 'NULL'} AS project_id,
            ${hasSupervisorId ? 'w.supervisor_id' : 'NULL'} AS supervisor_id,
            COALESCE(w.is_active, TRUE) AS is_active,
            COALESCE(w.employment_status, 'active') AS employment_status
     FROM workers w
     WHERE w.id = $1
       AND w.company_id = $2
       AND w.deleted_at IS NULL
     LIMIT 1`,
    [workerId, companyId]
  );

  if (result.rowCount === 0) {
    throw createHttpError(404, WORKER_ASSIGNMENT_ERROR_CODES.WORKER_NOT_FOUND, 'El trabajador no existe o no pertenece a la empresa.');
  }

  return result.rows[0];
}

async function getActiveCrewAssignment(workerId, companyId, dbClient = null) {
  const db = getDb(dbClient);
  const result = await db.query(
    `SELECT cw.crew_id,
            wc.work_location_id,
            wc.supervisor_id
     FROM crew_workers cw
     JOIN work_crews wc ON wc.id = cw.crew_id
     WHERE cw.worker_id = $1
       AND cw.company_id = $2
       AND cw.is_active = TRUE
       AND cw.unassigned_at IS NULL
       AND wc.company_id = $2
       AND wc.deleted_at IS NULL
       AND COALESCE(wc.is_active, wc.status, TRUE) = TRUE
     ORDER BY cw.assigned_at DESC NULLS LAST, cw.created_at DESC NULLS LAST
     LIMIT 1`,
    [workerId, companyId]
  );

  return result.rows[0] || null;
}

async function getActiveLocationAssignment(workerId, companyId, dbClient = null) {
  const db = getDb(dbClient);
  try {
    const result = await db.query(
      `SELECT work_location_id,
              assignment_type
       FROM worker_location_assignments
       WHERE worker_id = $1
         AND company_id = $2
         AND is_active = TRUE
         AND start_date <= CURRENT_DATE
         AND (end_date IS NULL OR end_date >= CURRENT_DATE)
       ORDER BY CASE WHEN assignment_type = 'temporary' THEN 0 ELSE 1 END,
                created_at DESC NULLS LAST
       LIMIT 1`,
      [workerId, companyId]
    );
    return result.rows[0] || null;
  } catch (error) {
    if (['42P01', '42703'].includes(error.code)) return null;
    throw error;
  }
}

async function getActiveProjectAssignment(worker, companyId, dbClient = null) {
  if (worker.project_id) {
    return { project_id: worker.project_id };
  }

  const db = getDb(dbClient);
  try {
    const result = await db.query(
      `SELECT pa.project_id
       FROM project_assignments pa
       JOIN projects p ON p.id = pa.project_id
       WHERE pa.worker_id = $1
         AND pa.unassigned_at IS NULL
         AND p.company_id = $2
         AND COALESCE(p.is_active, TRUE) = TRUE
       ORDER BY pa.assigned_at DESC NULLS LAST
       LIMIT 1`,
      [worker.id, companyId]
    );
    return result.rows[0] || null;
  } catch (error) {
    if (['42P01', '42703'].includes(error.code)) return null;
    throw error;
  }
}

async function getWorkerAssignmentSnapshot({ workerId, companyId, dbClient = null }) {
  assertWorkerId(workerId);

  const worker = await getWorkerBase(workerId, companyId, dbClient);
  const [crew, locationAssignment, project] = await Promise.all([
    getActiveCrewAssignment(workerId, companyId, dbClient),
    getActiveLocationAssignment(workerId, companyId, dbClient),
    getActiveProjectAssignment(worker, companyId, dbClient)
  ]);

  const currentWorkLocationId = locationAssignment?.work_location_id
    || crew?.work_location_id
    || worker.work_location_id
    || null;
  const currentCrewId = crew?.crew_id || null;
  const currentProjectId = project?.project_id || null;
  const currentSupervisorId = crew?.supervisor_id || worker.supervisor_id || null;
  const isBusy = Boolean(currentWorkLocationId || currentCrewId || currentProjectId);

  return {
    workerId,
    companyId,
    worker,
    assignmentStatus: isBusy ? 'busy' : 'available',
    currentWorkLocationId,
    currentCrewId,
    currentProjectId,
    currentSupervisorId,
    currentAssignmentSource: locationAssignment
      ? `${locationAssignment.assignment_type || 'location'}_assignment`
      : (currentCrewId ? 'crew' : (currentProjectId ? 'project' : (currentWorkLocationId ? 'worker' : null)))
  };
}

async function resolveTarget({ companyId, targetWorkLocationId = null, targetCrewId = null, targetProjectId = null, dbClient = null }) {
  assertOptionalUuid(targetWorkLocationId, 'targetWorkLocationId', 'INVALID_WORK_LOCATION_ID');
  assertOptionalUuid(targetCrewId, 'targetCrewId', 'INVALID_CREW_ID');
  assertOptionalUuid(targetProjectId, 'targetProjectId', 'INVALID_PROJECT_ID');

  if (!targetCrewId) {
    return { targetWorkLocationId, targetCrewId, targetProjectId };
  }

  const db = getDb(dbClient);
  const result = await db.query(
    `SELECT id, work_location_id
     FROM work_crews
     WHERE id = $1
       AND company_id = $2
       AND deleted_at IS NULL
       AND COALESCE(is_active, status, TRUE) = TRUE
     LIMIT 1`,
    [targetCrewId, companyId]
  );

  if (result.rowCount === 0) {
    throw createHttpError(422, 'WORK_CREW_INVALID', 'La cuadrilla no existe, no pertenece a la empresa o no esta activa.');
  }

  const crewWorkLocationId = result.rows[0].work_location_id || null;
  if (targetWorkLocationId && crewWorkLocationId && !isSameId(targetWorkLocationId, crewWorkLocationId)) {
    throw createHttpError(422, 'CREW_LOCATION_MISMATCH', 'La cuadrilla destino no pertenece a la obra indicada.');
  }

  return {
    targetWorkLocationId: targetWorkLocationId || crewWorkLocationId,
    targetCrewId,
    targetProjectId
  };
}

function buildConflictDetails(snapshot, target = {}) {
  return {
    workerId: snapshot.workerId,
    currentWorkLocationId: snapshot.currentWorkLocationId,
    currentCrewId: snapshot.currentCrewId,
    currentProjectId: snapshot.currentProjectId,
    requestedWorkLocationId: target.targetWorkLocationId || null,
    requestedCrewId: target.targetCrewId || null,
    requestedProjectId: target.targetProjectId || null
  };
}

function isCurrentSupervisor(user = {}, snapshot) {
  return Boolean(snapshot.currentSupervisorId && isSameId(user.id, snapshot.currentSupervisorId));
}

function canReassignWorker(user = {}, snapshot) {
  return hasReassignPermission(user) || isCurrentSupervisor(user, snapshot);
}

async function assertCanReassignWorker({ workerId, companyId, actor, dbClient = null }) {
  const snapshot = await getWorkerAssignmentSnapshot({ workerId, companyId, dbClient });
  if (canReassignWorker(actor, snapshot)) {
    return snapshot;
  }

  throw createHttpError(
    403,
    WORKER_ASSIGNMENT_ERROR_CODES.WORKER_REASSIGN_FORBIDDEN,
    'No tienes permisos para mover este trabajador. Solo el supervisor actual o un administrador puede hacerlo.'
  );
}

function targetConflictsWithSnapshot(snapshot, target = {}) {
  const requestedWorkLocationId = normalizeId(target.targetWorkLocationId);
  const requestedCrewId = normalizeId(target.targetCrewId);
  const requestedProjectId = normalizeId(target.targetProjectId);

  if (requestedCrewId && snapshot.currentCrewId && !isSameId(requestedCrewId, snapshot.currentCrewId)) {
    return true;
  }

  if (requestedWorkLocationId && snapshot.currentWorkLocationId && !isSameId(requestedWorkLocationId, snapshot.currentWorkLocationId)) {
    return true;
  }

  if (requestedProjectId && snapshot.currentProjectId && !isSameId(requestedProjectId, snapshot.currentProjectId)) {
    return true;
  }

  if (snapshot.currentProjectId && (requestedCrewId || requestedWorkLocationId)) {
    return true;
  }

  if (requestedProjectId && (snapshot.currentCrewId || snapshot.currentWorkLocationId)) {
    return true;
  }

  return false;
}

async function assertWorkerCanAssignToTarget({
  workerId,
  companyId,
  actor,
  targetWorkLocationId = null,
  targetCrewId = null,
  targetProjectId = null,
  operation = 'normal',
  dbClient = null
}) {
  assertWorkerId(workerId);
  const target = await resolveTarget({
    companyId,
    targetWorkLocationId,
    targetCrewId,
    targetProjectId,
    dbClient
  });
  const snapshot = await getWorkerAssignmentSnapshot({ workerId, companyId, dbClient });

  if (targetCrewId && snapshot.currentCrewId && isSameId(targetCrewId, snapshot.currentCrewId)) {
    throw createHttpError(
      409,
      WORKER_ASSIGNMENT_ERROR_CODES.WORKER_ALREADY_IN_CREW,
      'El trabajador ya pertenece a esta cuadrilla.',
      undefined,
      buildConflictDetails(snapshot, target)
    );
  }

  if (snapshot.assignmentStatus === 'available' || !targetConflictsWithSnapshot(snapshot, target)) {
    return snapshot;
  }

  if (canReassignWorker(actor, snapshot)) {
    return snapshot;
  }

  if (operation === 'reassign') {
    throw createHttpError(
      403,
      WORKER_ASSIGNMENT_ERROR_CODES.WORKER_REASSIGN_FORBIDDEN,
      'No tienes permisos para mover este trabajador. Solo el supervisor actual o un administrador puede hacerlo.'
    );
  }

  throw createHttpError(
    409,
    WORKER_ASSIGNMENT_ERROR_CODES.WORKER_ALREADY_ASSIGNED,
    'El trabajador ya se encuentra asignado a otra obra o cuadrilla. Solo su supervisor actual o un administrador puede reasignarlo.',
    undefined,
    buildConflictDetails(snapshot, target)
  );
}

module.exports = {
  WORKER_ASSIGNMENT_ERROR_CODES,
  getWorkerAssignmentSnapshot,
  canReassignWorker,
  assertCanReassignWorker,
  assertWorkerCanAssignToTarget
};
