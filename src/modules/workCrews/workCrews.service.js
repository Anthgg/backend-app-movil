const { query, withTransaction } = require('../../config/database');
const { createHttpError } = require('../../shared/utils/http-error');
const supervisorRules = require('./supervisorRules.service');
const {
  getWorker,
  getActiveWorkLocation,
  logAssignmentHistory
} = require('../../shared/services/worker-location-assignment.service');
const { mapCrewWorkerItem } = require('../../mappers/worker.mapper');
const { logAuditEvent } = require('../../utils/audit.util');

const CREW_SELECT = `
  SELECT wc.*,
         wl.name AS work_location_name,
         wl.address AS work_location_address,
         wl.latitude AS work_location_latitude,
         wl.longitude AS work_location_longitude,
         wl.allowed_radius_meters,
         CONCAT_WS(' ', u.first_name, u.last_name) AS supervisor_name,
         u.email AS supervisor_email,
         COUNT(cw.id) FILTER (WHERE cw.is_active = TRUE AND cw.unassigned_at IS NULL) AS active_workers_count,
         COUNT(cw.id) FILTER (
           WHERE cw.is_active = TRUE 
             AND cw.unassigned_at IS NULL
             AND EXISTS (
               SELECT 1 FROM worker_location_assignments wla
               WHERE wla.company_id = wc.company_id
                 AND wla.worker_id = cw.worker_id
                 AND wla.assignment_type = 'temporary'
                 AND wla.is_active = TRUE
                 AND wla.start_date <= CURRENT_DATE
                 AND (wla.end_date IS NULL OR wla.end_date >= CURRENT_DATE)
                 AND wla.work_location_id IS DISTINCT FROM wc.work_location_id
             )
         ) AS temporarily_moved_workers_count,
         COALESCE(MAX(movement_stats.total_movements), 0)::int AS total_movements,
         GREATEST(
           COALESCE(wc.updated_at, wc.created_at),
           COALESCE(MAX(movement_stats.last_movement_at), wc.created_at)
         ) AS last_updated_at
  FROM work_crews wc
  JOIN work_locations wl ON wl.id = wc.work_location_id
  JOIN users u ON u.id = wc.supervisor_id
  LEFT JOIN crew_workers cw ON cw.crew_id = wc.id AND cw.company_id = wc.company_id
  LEFT JOIN LATERAL (
    SELECT COUNT(DISTINCT wah.id)::int AS total_movements,
           MAX(wah.changed_at) AS last_movement_at
    FROM worker_assignment_history wah
    WHERE wah.company_id = wc.company_id
      AND (
        wah.previous_crew_id = wc.id
        OR wah.new_crew_id = wc.id
        OR EXISTS (
          SELECT 1
          FROM crew_workers history_cw
          WHERE history_cw.company_id = wc.company_id
            AND history_cw.crew_id = wc.id
            AND history_cw.worker_id = wah.worker_id
            AND wah.changed_at >= history_cw.assigned_at
            AND (
              history_cw.unassigned_at IS NULL
              OR wah.changed_at <= history_cw.unassigned_at
            )
        )
      )
  ) movement_stats ON TRUE
`;

function isAdminLike(user) {
  return user?.roles?.some((role) => ['ADMIN', 'RRHH'].includes(role));
}

function isSupervisor(user) {
  return user?.roles?.includes('SUPERVISOR');
}

async function assertCrewAccess(crew, user) {
  if (isAdminLike(user)) return;
  if (isSupervisor(user) && crew.supervisor_id === user.id) return;
  throw createHttpError(403, 'CREW_ACCESS_DENIED', 'No tiene acceso a esta cuadrilla.');
}

async function assertUniqueCrewName(companyId, name, excludedId = null) {
  const params = [companyId, name];
  let excludedSql = '';
  if (excludedId) {
    params.push(excludedId);
    excludedSql = `AND id <> $${params.length}`;
  }

  const result = await query(
    `SELECT 1 FROM work_crews
     WHERE company_id = $1
       AND LOWER(name) = LOWER($2)
       AND deleted_at IS NULL
       ${excludedSql}`,
    params
  );

  if (result.rowCount > 0) {
    throw createHttpError(409, 'WORK_CREW_ALREADY_EXISTS', 'Ya existe una cuadrilla con ese nombre.');
  }
}

async function getCrewById(id, companyId, user = null) {
  const result = await query(
    `${CREW_SELECT}
     WHERE wc.id = $1
       AND wc.company_id = $2
       AND wc.deleted_at IS NULL
     GROUP BY wc.id, wl.id, u.id`,
    [id, companyId]
  );

  if (result.rowCount === 0) {
    throw createHttpError(404, 'WORK_CREW_NOT_FOUND', 'La cuadrilla no existe o no pertenece a la empresa.');
  }

  const crew = result.rows[0];
  if (user) await assertCrewAccess(crew, user);
  return crew;
}

async function getWorkCrews(companyId, filters = {}, user = null) {
  const params = [companyId];
  const where = ['wc.company_id = $1', 'wc.deleted_at IS NULL'];

  if (!(filters.include_inactive === 'true' || filters.status === 'all')) {
    where.push('COALESCE(wc.is_active, wc.status, TRUE) = TRUE');
  }
  if (filters.supervisor_id) {
    params.push(filters.supervisor_id);
    where.push(`wc.supervisor_id = $${params.length}`);
  }
  if (filters.work_location_id) {
    params.push(filters.work_location_id);
    where.push(`wc.work_location_id = $${params.length}`);
  }
  if (user && !isAdminLike(user) && isSupervisor(user)) {
    params.push(user.id);
    where.push(`wc.supervisor_id = $${params.length}`);
  }

  const result = await query(
    `${CREW_SELECT}
     WHERE ${where.join(' AND ')}
     GROUP BY wc.id, wl.id, u.id
     ORDER BY wc.name ASC`,
    params
  );
  return result.rows.map(mapCrewWorkerItem);
}

async function logSupervisorLimitWarnings({ companyId, user, crewId, warnings = [] }) {
  if (!warnings.length) return;

  for (const warning of warnings) {
    await logAuditEvent({
      userId: user?.id,
      companyId,
      module: 'WORK_CREWS',
      action: warning.code || 'SUPERVISOR_CREWS_LIMIT_WARNING',
      entity: 'work_crews',
      entityId: crewId,
      newData: {
        code: warning.code,
        message: warning.message,
        ...(warning.details || {})
      }
    });
  }
}

async function createCrew(companyId, data, user) {
  await assertUniqueCrewName(companyId, data.name);
  const supervisorValidation = await supervisorRules.validateSupervisorAssignment({
    supervisorId: data.supervisor_id,
    companyId
  });
  const warnings = supervisorValidation.warnings || [];
  const location = await getActiveWorkLocation(data.work_location_id, companyId);

  const result = await query(
    `INSERT INTO work_crews (
       company_id, name, description, supervisor_id, work_location_id,
       is_active, status, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$6,$7)
     RETURNING *`,
    [
      companyId,
      data.name,
      data.description || null,
      data.supervisor_id,
      location.id,
      data.is_active !== false && data.status !== false,
      user.id
    ]
  );

  const crew = await getCrewById(result.rows[0].id, companyId, user);
  await logSupervisorLimitWarnings({ companyId, user, crewId: crew.id, warnings });

  return { data: crew, warnings };
}

async function updateCrew(id, companyId, data, user) {
  const current = await getCrewById(id, companyId, user);
  let warnings = [];

  if (data.name && data.name.toLowerCase() !== current.name.toLowerCase()) {
    await assertUniqueCrewName(companyId, data.name, id);
  }
  if (data.supervisor_id !== undefined) {
    const supervisorValidation = await supervisorRules.validateSupervisorAssignment({
      supervisorId: data.supervisor_id,
      companyId,
      excludeCrewId: id
    });
    warnings = supervisorValidation.warnings || [];
  }
  if (data.work_location_id && data.work_location_id !== current.work_location_id) {
    await getActiveWorkLocation(data.work_location_id, companyId);
  }

  const fields = [];
  const values = [];
  const append = (field, value) => {
    if (value !== undefined) {
      values.push(value);
      fields.push(`${field} = $${values.length}`);
    }
  };

  append('name', data.name);
  append('description', data.description);
  append('supervisor_id', data.supervisor_id);
  append('work_location_id', data.work_location_id);
  if (data.is_active !== undefined || data.status !== undefined) {
    const active = data.is_active !== undefined ? data.is_active : data.status;
    append('is_active', active);
    append('status', active);
  }
  append('updated_by', user.id);
  fields.push('updated_at = NOW()');
  values.push(id, companyId);

  await query(
    `UPDATE work_crews SET ${fields.join(', ')}
     WHERE id = $${values.length - 1} AND company_id = $${values.length}`,
    values
  );

  if (data.work_location_id && data.work_location_id !== current.work_location_id) {
    await syncCrewWorkersLocation(id, companyId, data.work_location_id);
  }

  const crew = await getCrewById(id, companyId, user);
  await logSupervisorLimitWarnings({ companyId, user, crewId: crew.id, warnings });

  return { data: crew, warnings };
}

async function updateCrewStatus(id, companyId, isActive, user) {
  const current = await getCrewById(id, companyId, user);
  await query(
    `UPDATE work_crews
     SET is_active = $1, status = $1, updated_by = $2, updated_at = NOW()
     WHERE id = $3 AND company_id = $4`,
    [isActive, user.id, id, companyId]
  );

  if (isActive === false) {
    await query(
      `UPDATE crew_workers
       SET is_active = FALSE, unassigned_at = COALESCE(unassigned_at, NOW()), updated_by = $1, updated_at = NOW()
       WHERE crew_id = $2 AND company_id = $3 AND is_active = TRUE`,
      [user.id, id, companyId]
    );
  }

  return {
    ...current,
    is_active: isActive,
    status: isActive
  };
}

async function syncCrewWorkersLocation(crewId, companyId, workLocationId, db = { query }) {
  await db.query(
    `UPDATE workers w
     SET work_location_id = $1, updated_at = NOW()
     FROM crew_workers cw
     WHERE cw.worker_id = w.id
       AND cw.crew_id = $2
       AND cw.company_id = $3
       AND cw.is_active = TRUE
       AND cw.unassigned_at IS NULL
       AND w.company_id = $3
       AND w.deleted_at IS NULL`,
    [workLocationId, crewId, companyId]
  );
}

async function updateCrewWorkLocation(id, companyId, data, user) {
  const current = await getCrewById(id, companyId, user);
  const location = await getActiveWorkLocation(data.work_location_id, companyId);

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE work_crews
       SET work_location_id = $1, updated_by = $2, updated_at = NOW()
       WHERE id = $3 AND company_id = $4`,
      [location.id, user.id, id, companyId]
    );
    await syncCrewWorkersLocation(id, companyId, location.id, client);

    const workerRes = await client.query(
      `SELECT worker_id
       FROM crew_workers
       WHERE crew_id = $1 AND company_id = $2 AND is_active = TRUE AND unassigned_at IS NULL`,
      [id, companyId]
    );
    for (const row of workerRes.rows) {
      await logAssignmentHistory({
        companyId,
        workerId: row.worker_id,
        previousWorkLocationId: current.work_location_id,
        newWorkLocationId: location.id,
        previousCrewId: id,
        newCrewId: id,
        changedBy: user.id,
        changeType: 'crew_work_location_changed',
        reason: data.reason || null
      }, client);
    }
  });

  return getCrewById(id, companyId, user);
}

async function addWorkersToCrew(crewId, companyId, workerIds, user, reason = null) {
  const crew = await getCrewById(crewId, companyId, user);
  if (!crew.is_active) {
    throw createHttpError(422, 'WORK_CREW_INACTIVE', 'No se puede asignar trabajadores a una cuadrilla inactiva.');
  }

  try {
    return await withTransaction(async (client) => {
    const assigned = [];
    for (const workerId of workerIds) {
      const worker = await getWorker(workerId, companyId);
      const previousRes = await client.query(
        `SELECT cw.crew_id, wc.work_location_id
         FROM crew_workers cw
         JOIN work_crews wc ON wc.id = cw.crew_id
         WHERE cw.company_id = $1
           AND cw.worker_id = $2
           AND cw.is_active = TRUE
           AND cw.unassigned_at IS NULL
         LIMIT 1`,
        [companyId, workerId]
      );
      const previous = previousRes.rows[0] || null;

      await client.query(
        `UPDATE crew_workers
         SET is_active = FALSE, unassigned_at = NOW(), updated_by = $3, updated_at = NOW()
         WHERE company_id = $1 AND worker_id = $2 AND is_active = TRUE AND unassigned_at IS NULL`,
        [companyId, workerId, user.id]
      );

      const memberRes = await client.query(
        `INSERT INTO crew_workers (company_id, crew_id, worker_id, created_by)
         VALUES ($1,$2,$3,$4)
         RETURNING *`,
        [companyId, crewId, workerId, user.id]
      );

      await client.query(
        `UPDATE workers
         SET work_location_id = $1, updated_at = NOW()
         WHERE id = $2 AND company_id = $3`,
        [crew.work_location_id, workerId, companyId]
      );

      await logAssignmentHistory({
        companyId,
        workerId,
        previousWorkLocationId: previous?.work_location_id || worker.work_location_id || null,
        newWorkLocationId: crew.work_location_id,
        previousCrewId: previous?.crew_id || null,
        newCrewId: crewId,
        changedBy: user.id,
        changeType: previous ? 'worker_moved_crew' : 'worker_added_to_crew',
        reason
      }, client);

      assigned.push(memberRes.rows[0]);
    }
    return assigned;
    });
  } catch (error) {
    throw error;
  }
}

async function getCrewWorkers(crewId, companyId, user) {
  await getCrewById(crewId, companyId, user);
  const result = await query(
    `SELECT cw.*,
            cw.id AS crew_worker_id,
            w.id AS id,
            w.id AS worker_id,
            w.id AS "workerId",
            w.user_id,
            w.user_id AS "userId",
            w.document_number,
            'complete' AS profile_status,
            CONCAT_WS(' ', u.first_name, u.last_name) AS worker_name,
            u.first_name,
            u.last_name,
            u.email AS worker_email,
            w.personal_id,
            w.work_location_id,
            wl.name AS work_location_name,
            CASE
              WHEN temp.assignment_id IS NOT NULL THEN jsonb_build_object(
                'source', 'temporary_assignment',
                'work_location_id', temp.work_location_id,
                'work_location_name', temp.work_location_name,
                'start_date', temp.start_date,
                'end_date', temp.end_date,
                'reason', temp.reason
              )
              WHEN perm.assignment_id IS NOT NULL THEN jsonb_build_object(
                'source', 'direct_worker_location',
                'work_location_id', perm.work_location_id,
                'work_location_name', perm.work_location_name,
                'start_date', perm.start_date,
                'end_date', perm.end_date,
                'reason', perm.reason
              )
              WHEN w.work_location_id IS NOT NULL AND w.work_location_id <> wc.work_location_id THEN jsonb_build_object(
                'source', 'direct_worker_location',
                'work_location_id', w.work_location_id,
                'work_location_name', wl.name,
                'start_date', NULL,
                'end_date', NULL,
                'reason', NULL
              )
              ELSE jsonb_build_object(
                'source', 'crew_location',
                'work_location_id', wc.work_location_id,
                'work_location_name', crew_wl.name,
                'start_date', NULL,
                'end_date', NULL,
                'reason', NULL
              )
            END AS active_assignment
      FROM workers w
      JOIN users u ON u.id = w.user_id
      JOIN work_crews wc ON wc.id = $1 AND wc.company_id = $2
      LEFT JOIN crew_workers cw ON cw.worker_id = w.id AND cw.crew_id = wc.id AND cw.company_id = wc.company_id AND cw.is_active = TRUE AND cw.unassigned_at IS NULL
      LEFT JOIN work_locations crew_wl ON crew_wl.id = wc.work_location_id
      LEFT JOIN work_locations wl ON wl.id = w.work_location_id
      LEFT JOIN LATERAL (
        SELECT wla.id AS assignment_id,
               wla.work_location_id,
               wla.start_date,
               wla.end_date,
               wla.reason,
               assigned_wl.name AS work_location_name
        FROM worker_location_assignments wla
        JOIN work_locations assigned_wl ON assigned_wl.id = wla.work_location_id
        WHERE wla.company_id = w.company_id
          AND wla.worker_id = w.id
          AND wla.assignment_type = 'temporary'
          AND wla.is_active = TRUE
          AND wla.start_date <= CURRENT_DATE
          AND (wla.end_date IS NULL OR wla.end_date >= CURRENT_DATE)
          AND assigned_wl.company_id = w.company_id
          AND assigned_wl.deleted_at IS NULL
          AND COALESCE(assigned_wl.is_active, assigned_wl.status, TRUE) = TRUE
        ORDER BY wla.created_at DESC
        LIMIT 1
      ) temp ON TRUE
      LEFT JOIN LATERAL (
        SELECT wla.id AS assignment_id,
               wla.work_location_id,
               wla.start_date,
               wla.end_date,
               wla.reason,
               assigned_wl.name AS work_location_name
        FROM worker_location_assignments wla
        JOIN work_locations assigned_wl ON assigned_wl.id = wla.work_location_id
        WHERE wla.company_id = w.company_id
          AND wla.worker_id = w.id
          AND wla.assignment_type = 'permanent'
          AND wla.is_active = TRUE
          AND assigned_wl.company_id = w.company_id
         AND assigned_wl.deleted_at IS NULL
         AND COALESCE(assigned_wl.is_active, assigned_wl.status, TRUE) = TRUE
       ORDER BY wla.created_at DESC
       LIMIT 1
     ) perm ON TRUE
     WHERE w.company_id = $2
       AND w.deleted_at IS NULL
       AND (
         (cw.crew_id = $1 AND cw.is_active = TRUE AND cw.unassigned_at IS NULL)
         OR
         (temp.assignment_id IS NOT NULL AND temp.work_location_id = wc.work_location_id)
       )
     ORDER BY worker_name ASC`,
    [crewId, companyId]
  );
  return result.rows;
}

async function removeWorkerFromCrew(crewId, workerId, companyId, user, reason = null) {
  const crew = await getCrewById(crewId, companyId, user);
  const result = await query(
    `UPDATE crew_workers
     SET is_active = FALSE, unassigned_at = NOW(), updated_by = $4, updated_at = NOW()
     WHERE crew_id = $1
       AND worker_id = $2
       AND company_id = $3
       AND is_active = TRUE
       AND unassigned_at IS NULL
     RETURNING *`,
    [crewId, workerId, companyId, user.id]
  );

  if (result.rowCount === 0) {
    throw createHttpError(404, 'CREW_WORKER_NOT_FOUND', 'El trabajador no pertenece activamente a esta cuadrilla.');
  }

  await logAssignmentHistory({
    companyId,
    workerId,
    previousWorkLocationId: crew.work_location_id,
    newWorkLocationId: null,
    previousCrewId: crewId,
    newCrewId: null,
    changedBy: user.id,
    changeType: 'worker_removed_from_crew',
    reason
  });

  return result.rows[0];
}

async function moveWorkerToCrew(workerId, companyId, crewId, user, reason = null) {
  return addWorkersToCrew(crewId, companyId, [workerId], user, reason).then((rows) => rows[0]);
}

module.exports = {
  getWorkCrews,
  getCrewById,
  createCrew,
  updateCrew,
  updateCrewStatus,
  updateCrewWorkLocation,
  addWorkersToCrew,
  getCrewWorkers,
  removeWorkerFromCrew,
  moveWorkerToCrew
};
