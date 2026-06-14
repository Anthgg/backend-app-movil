const { query, withTransaction } = require('../../config/database');
const { createHttpError } = require('../utils/http-error');
const assignmentGuard = require('./worker-assignment-guard.service');

let hasAutoReturnColumnCache = null;

function normalizeDate(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

async function hasAutoReturnColumn(db = { query }) {
  if (hasAutoReturnColumnCache !== null) return hasAutoReturnColumnCache;
  const result = await db.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'worker_location_assignments'
       AND column_name = 'auto_return'
     LIMIT 1`
  );
  hasAutoReturnColumnCache = result.rowCount > 0;
  return hasAutoReturnColumnCache;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getWorker(workerId, companyId, { requireActive = true } = {}) {
  if (!UUID_REGEX.test(String(workerId || ''))) {
    throw createHttpError(400, 'INVALID_WORKER_ID', 'El ID del trabajador no es un UUID válido.');
  }

  const result = await query(
    `SELECT w.id, w.company_id, w.user_id, w.work_location_id,
            COALESCE(w.is_active, TRUE) AS is_active,
            COALESCE(w.employment_status, 'active') AS employment_status,
            CONCAT_WS(' ', u.first_name, u.last_name) AS worker_name
     FROM workers w
     LEFT JOIN users u ON u.id = w.user_id
     WHERE w.id = $1
       AND w.company_id = $2
       AND w.deleted_at IS NULL`,
    [workerId, companyId]
  );

  if (result.rowCount === 0) {
    throw createHttpError(404, 'WORKER_NOT_FOUND', 'El trabajador no existe o no pertenece a la empresa.');
  }

  const worker = result.rows[0];
  if (requireActive && (!worker.is_active || worker.employment_status !== 'active')) {
    throw createHttpError(422, 'WORKER_NOT_ACTIVE', 'El trabajador no esta activo.');
  }

  return worker;
}

async function getActiveWorkLocation(workLocationId, companyId) {
  if (!UUID_REGEX.test(String(workLocationId || ''))) {
    throw createHttpError(400, 'INVALID_WORK_LOCATION_ID', 'El ID de la obra no es un UUID válido.');
  }

  const result = await query(
    `SELECT id, company_id, name, address, latitude, longitude, allowed_radius_meters,
            COALESCE(is_active, status, TRUE) AS is_active
     FROM work_locations
     WHERE id = $1
       AND company_id = $2
       AND deleted_at IS NULL
       AND COALESCE(is_active, status, TRUE) = TRUE`,
    [workLocationId, companyId]
  );

  if (result.rowCount === 0) {
    throw createHttpError(422, 'WORK_LOCATION_INVALID', 'La obra no existe, no pertenece a la empresa o no esta activa.');
  }

  return result.rows[0];
}


async function getActiveTemporaryAssignment(workerId, companyId, date = null) {
  const targetDate = normalizeDate(date);
  const includeAutoReturn = await hasAutoReturnColumn();
  const result = await query(
    `SELECT wla.id AS assignment_id,
            wla.assignment_type,
            wla.start_date,
            wla.end_date,
            wla.reason,
            ${includeAutoReturn ? 'COALESCE(wla.auto_return, FALSE)' : 'FALSE'} AS auto_return,
            wl.id AS work_location_id,
            wl.name,
            wl.address,
            wl.latitude,
            wl.longitude,
            wl.allowed_radius_meters,
            COALESCE(wl.is_active, wl.status, TRUE) AS is_active
     FROM worker_location_assignments wla
     JOIN work_locations wl ON wl.id = wla.work_location_id
     WHERE wla.worker_id = $1
       AND wla.company_id = $2
       AND wla.assignment_type = 'temporary'
       AND wla.is_active = TRUE
       AND wla.start_date <= $3::date
       AND (wla.end_date IS NULL OR wla.end_date >= $3::date)
       AND wl.company_id = $2
       AND wl.deleted_at IS NULL
       AND COALESCE(wl.is_active, wl.status, TRUE) = TRUE
     ORDER BY wla.created_at DESC
     LIMIT 1`,
    [workerId, companyId, targetDate]
  );

  return result.rows[0] || null;
}

async function getActiveCrewLocation(workerId, companyId) {
  const result = await query(
    `SELECT cw.crew_id,
            wc.name AS crew_name,
            wc.supervisor_id,
            wl.id AS work_location_id,
            wl.name,
            wl.address,
            wl.latitude,
            wl.longitude,
            wl.allowed_radius_meters,
            COALESCE(wl.is_active, wl.status, TRUE) AS is_active
     FROM crew_workers cw
     JOIN work_crews wc ON wc.id = cw.crew_id
     JOIN work_locations wl ON wl.id = wc.work_location_id
     WHERE cw.worker_id = $1
       AND cw.company_id = $2
       AND cw.is_active = TRUE
       AND cw.unassigned_at IS NULL
       AND wc.company_id = $2
       AND wc.deleted_at IS NULL
       AND COALESCE(wc.is_active, wc.status, TRUE) = TRUE
       AND wl.company_id = $2
       AND wl.deleted_at IS NULL
       AND COALESCE(wl.is_active, wl.status, TRUE) = TRUE
     ORDER BY cw.assigned_at DESC
     LIMIT 1`,
    [workerId, companyId]
  );

  return result.rows[0] || null;
}

async function getDirectWorkerLocation(worker, companyId) {
  if (!worker?.work_location_id) return null;
  const location = await getActiveWorkLocation(worker.work_location_id, companyId);
  return {
    ...location,
    work_location_id: location.id
  };
}

async function getActivePermanentAssignment(workerId, companyId) {
  const includeAutoReturn = await hasAutoReturnColumn();
  const result = await query(
    `SELECT wla.id AS assignment_id,
            wla.assignment_type,
            wla.start_date,
            wla.end_date,
            wla.reason,
            ${includeAutoReturn ? 'COALESCE(wla.auto_return, FALSE)' : 'FALSE'} AS auto_return,
            wl.id AS work_location_id,
            wl.name,
            wl.address,
            wl.latitude,
            wl.longitude,
            wl.allowed_radius_meters,
            COALESCE(wl.is_active, wl.status, TRUE) AS is_active
     FROM worker_location_assignments wla
     JOIN work_locations wl ON wl.id = wla.work_location_id
     WHERE wla.worker_id = $1
       AND wla.company_id = $2
       AND wla.assignment_type = 'permanent'
       AND wla.is_active = TRUE
       AND wl.company_id = $2
       AND wl.deleted_at IS NULL
       AND COALESCE(wl.is_active, wl.status, TRUE) = TRUE
     ORDER BY wla.created_at DESC
     LIMIT 1`,
    [workerId, companyId]
  );

  return result.rows[0] || null;
}

function serializeActiveLocation(workerId, source, row, assignment = null) {
  return {
    worker_id: workerId,
    workerId,
    source,
    work_location: {
      id: row.work_location_id || row.id,
      name: row.name,
      address: row.address,
      latitude: row.latitude,
      longitude: row.longitude,
      allowed_radius_meters: row.allowed_radius_meters
    },
    crew: row.crew_id ? {
      id: row.crew_id,
      name: row.crew_name,
      supervisor_id: row.supervisor_id
    } : null,
    assignment
  };
}

async function getActiveWorkLocationForWorker(workerId, companyId, date = null) {
  const worker = await getWorker(workerId, companyId);

  const temporary = await getActiveTemporaryAssignment(workerId, companyId, date);
  if (temporary) {
    return serializeActiveLocation(workerId, 'temporary_assignment', temporary, {
      id: temporary.assignment_id,
      type: temporary.assignment_type,
      start_date: temporary.start_date,
      startDate: temporary.start_date,
      end_date: temporary.end_date,
      endDate: temporary.end_date,
      reason: temporary.reason,
      auto_return: temporary.auto_return,
      autoReturn: temporary.auto_return
    });
  }

  const permanent = await getActivePermanentAssignment(workerId, companyId);

  if (permanent) {
    return serializeActiveLocation(workerId, 'permanent_assignment', permanent, {
      id: permanent.assignment_id,
      type: permanent.assignment_type,
      start_date: permanent.start_date,
      end_date: permanent.end_date,
      reason: permanent.reason,
      auto_return: permanent.auto_return
    });
  }

  const directLocation = await getDirectWorkerLocation(worker, companyId);
  if (directLocation) {
    return serializeActiveLocation(workerId, 'direct_worker_location', directLocation);
  }

  const crewLocation = await getActiveCrewLocation(workerId, companyId);
  if (crewLocation) {
    return serializeActiveLocation(workerId, 'crew_location', crewLocation);
  }

  throw createHttpError(422, 'NO_ACTIVE_WORK_LOCATION', 'El trabajador no tiene una obra activa asignada para marcar asistencia.');
}

async function logAssignmentHistory({
  companyId,
  workerId = null,
  previousWorkLocationId = null,
  newWorkLocationId = null,
  previousCrewId = null,
  newCrewId = null,
  assignmentId = null,
  changedBy = null,
  changeType,
  assignmentType = null,
  startDate = null,
  endDate = null,
  reason = null
}, db = { query }) {
  await db.query(
    `INSERT INTO worker_assignment_history (
       company_id, worker_id, previous_work_location_id, new_work_location_id,
       previous_crew_id, new_crew_id, assignment_id, changed_by, change_type,
       assignment_type, start_date, end_date, reason
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      companyId,
      workerId,
      previousWorkLocationId,
      newWorkLocationId,
      previousCrewId,
      newCrewId,
      assignmentId,
      changedBy,
      changeType,
      assignmentType,
      startDate,
      endDate,
      reason
    ]
  );
}

async function getWorkerAssignmentHistory(workerId, companyId) {
  await getWorker(workerId, companyId, { requireActive: false });
  const result = await query(
    `SELECT wah.*,
            prev_wl.name AS previous_work_location_name,
            new_wl.name AS new_work_location_name,
            prev_wc.name AS previous_crew_name,
            new_wc.name AS new_crew_name,
            CONCAT_WS(' ', u.first_name, u.last_name) AS changed_by_name
     FROM worker_assignment_history wah
     LEFT JOIN work_locations prev_wl ON prev_wl.id = wah.previous_work_location_id
     LEFT JOIN work_locations new_wl ON new_wl.id = wah.new_work_location_id
     LEFT JOIN work_crews prev_wc ON prev_wc.id = wah.previous_crew_id
     LEFT JOIN work_crews new_wc ON new_wc.id = wah.new_crew_id
     LEFT JOIN users u ON u.id = wah.changed_by
     WHERE wah.worker_id = $1
       AND wah.company_id = $2
     ORDER BY wah.changed_at DESC`,
    [workerId, companyId]
  );
  return result.rows;
}

function isAdminLike(user) {
  return user?.roles?.some((role) => ['ADMIN', 'RRHH'].includes(role));
}

async function assertCanManageWorkerAssignment(user, workerId, companyId) {
  if (isAdminLike(user)) return;

  if (user?.roles?.includes('SUPERVISOR')) {
    const result = await query(
      `SELECT 1
       FROM crew_workers cw
       JOIN work_crews wc ON wc.id = cw.crew_id
       WHERE cw.worker_id = $1
         AND cw.company_id = $2
         AND cw.is_active = TRUE
         AND cw.unassigned_at IS NULL
         AND wc.supervisor_id = $3
         AND wc.deleted_at IS NULL
         AND COALESCE(wc.is_active, wc.status, TRUE) = TRUE
       LIMIT 1`,
      [workerId, companyId, user.id]
    );
    if (result.rowCount > 0) return;
  }

  throw createHttpError(403, 'WORKER_ASSIGNMENT_ACCESS_DENIED', 'No tiene permisos para gestionar asignaciones de este trabajador.');
}

async function assertCanViewWorkerLocation(user, workerId, companyId) {
  if (isAdminLike(user)) return;
  if (user?.worker_id === workerId) return;
  if (user?.roles?.includes('SUPERVISOR')) {
    await assertCanManageWorkerAssignment(user, workerId, companyId);
    return;
  }
  throw createHttpError(403, 'WORKER_LOCATION_ACCESS_DENIED', 'No tiene permisos para consultar la ubicacion de este trabajador.');
}

async function createWorkerLocationAssignment(workerId, companyId, data, changedBy, actor = null) {
  const worker = await getWorker(workerId, companyId);
  const location = await getActiveWorkLocation(data.work_location_id, companyId);
  const assignmentType = data.assignment_type || data.type || 'temporary';
  const startDate = normalizeDate(data.start_date);
  const endDate = data.end_date ? normalizeDate(data.end_date) : null;

  await assignmentGuard.assertWorkerCanAssignToTarget({
    workerId,
    companyId,
    actor: actor || { id: changedBy, roles: [], permissions: [] },
    targetWorkLocationId: location.id,
    operation: 'reassign'
  });

  if (!['temporary', 'permanent'].includes(assignmentType)) {
    throw createHttpError(422, 'INVALID_ASSIGNMENT_TYPE', 'El tipo de asignacion debe ser temporary o permanent.');
  }

  if (assignmentType === 'temporary' && !endDate) {
    throw createHttpError(422, 'TEMPORARY_ASSIGNMENT_END_DATE_REQUIRED', 'La asignacion temporal requiere fecha fin.');
  }

  try {
    return await withTransaction(async (client) => {
      const previousLocationId = worker.work_location_id || null;
      const includeAutoReturn = await hasAutoReturnColumn(client);

      if (assignmentType === 'permanent') {
        await client.query(
          `UPDATE worker_location_assignments
           SET is_active = FALSE, updated_at = NOW()
           WHERE company_id = $1 AND worker_id = $2 AND is_active = TRUE`,
          [companyId, workerId]
        );
      }

      const insertColumns = includeAutoReturn
        ? `company_id, worker_id, work_location_id, assigned_by, assignment_type,
           start_date, end_date, reason, auto_return, is_active`
        : `company_id, worker_id, work_location_id, assigned_by, assignment_type,
           start_date, end_date, reason, is_active`;
      const insertValuesSql = includeAutoReturn
        ? '$1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE'
        : '$1,$2,$3,$4,$5,$6,$7,$8,TRUE';
      const insertValues = [
        companyId,
        workerId,
        location.id,
        changedBy,
        assignmentType,
        startDate,
        endDate,
        data.reason || null
      ];
      if (includeAutoReturn) insertValues.push(data.auto_return === true);

      const insertRes = await client.query(
        `INSERT INTO worker_location_assignments (
           ${insertColumns}
         ) VALUES (${insertValuesSql})
         RETURNING *`,
        insertValues
      );

      const assignment = insertRes.rows[0];

      if (assignmentType === 'permanent') {
        await client.query(
          `UPDATE workers
           SET work_location_id = $1, updated_at = NOW()
           WHERE id = $2 AND company_id = $3`,
          [location.id, workerId, companyId]
        );
      }

      await logAssignmentHistory({
        companyId,
        workerId,
        previousWorkLocationId: previousLocationId,
        newWorkLocationId: location.id,
        assignmentId: assignment.id,
        changedBy,
        changeType: assignmentType === 'permanent' ? 'permanent_assignment_created' : 'temporary_assignment_created',
        assignmentType,
        startDate,
        endDate,
        reason: data.reason || null
      }, client);

      return {
        ...assignment,
        work_location_name: location.name
      };
    });
  } catch (error) {
    if (error.code === '23P01') {
      throw createHttpError(409, 'TEMPORARY_ASSIGNMENT_OVERLAP', 'Ya existe una asignacion temporal activa superpuesta para este trabajador.');
    }
    throw error;
  }
}

async function cancelWorkerLocationAssignment(id, companyId, changedByUser, reason = null) {
  if (!UUID_REGEX.test(String(id || ''))) {
    throw createHttpError(400, 'INVALID_ASSIGNMENT_ID', 'El ID de la asignación no es un UUID válido.');
  }

  const currentRes = await query(
    `SELECT * FROM worker_location_assignments
     WHERE id = $1 AND company_id = $2 AND is_active = TRUE`,
    [id, companyId]
  );
  if (currentRes.rowCount === 0) {
    throw createHttpError(404, 'ASSIGNMENT_NOT_FOUND', 'La asignacion no existe o ya fue cancelada.');
  }

  const current = currentRes.rows[0];
  await assertCanManageWorkerAssignment(changedByUser, current.worker_id, companyId);
  const changedBy = changedByUser.id;
  const result = await query(
    `UPDATE worker_location_assignments
     SET is_active = FALSE,
         cancelled_at = NOW(),
         cancelled_by = $3,
         cancellation_reason = $4,
         updated_at = NOW()
     WHERE id = $1 AND company_id = $2
     RETURNING *`,
    [id, companyId, changedBy, reason]
  );

  await logAssignmentHistory({
    companyId,
    workerId: current.worker_id,
    previousWorkLocationId: current.work_location_id,
    newWorkLocationId: null,
    assignmentId: current.id,
    changedBy,
    changeType: 'individual_location_assignment_cancelled',
    assignmentType: current.assignment_type,
    startDate: current.start_date,
    endDate: current.end_date,
    reason
  });

  return result.rows[0];
}

module.exports = {
  getWorker,
  getActiveWorkLocation,
  getActiveWorkLocationForWorker,
  assertCanManageWorkerAssignment,
  assertCanViewWorkerLocation,
  logAssignmentHistory,
  getWorkerAssignmentHistory,
  createWorkerLocationAssignment,
  cancelWorkerLocationAssignment
};
