const { query, withTransaction } = require('../../config/database');
const { createHttpError } = require('../../shared/utils/http-error');
const {
  getWorker,
  getActiveWorkLocation,
  logAssignmentHistory
} = require('../../shared/services/worker-location-assignment.service');

const CREW_SELECT = `
  SELECT wc.*,
         wl.name AS work_location_name,
         wl.address AS work_location_address,
         wl.latitude AS work_location_latitude,
         wl.longitude AS work_location_longitude,
         wl.allowed_radius_meters,
         CONCAT_WS(' ', u.first_name, u.last_name) AS supervisor_name,
         u.email AS supervisor_email,
         COUNT(cw.id) FILTER (WHERE cw.is_active = TRUE AND cw.unassigned_at IS NULL) AS active_workers_count
  FROM work_crews wc
  JOIN work_locations wl ON wl.id = wc.work_location_id
  JOIN users u ON u.id = wc.supervisor_id
  LEFT JOIN crew_workers cw ON cw.crew_id = wc.id AND cw.company_id = wc.company_id
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

async function validateSupervisor(supervisorId, companyId) {
  const result = await query(
    `SELECT u.id
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     WHERE u.id = $1
       AND u.company_id = $2
       AND u.deleted_at IS NULL
       AND u.is_active = TRUE
       AND u.status = 'active'
       AND UPPER(COALESCE(r.code, r.name)) = 'SUPERVISOR'
     LIMIT 1`,
    [supervisorId, companyId]
  );

  if (result.rowCount === 0) {
    throw createHttpError(422, 'INVALID_SUPERVISOR', 'El supervisor no existe, no esta activo o no tiene rol SUPERVISOR.');
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
  return result.rows;
}

async function createCrew(companyId, data, user) {
  await assertUniqueCrewName(companyId, data.name);
  await validateSupervisor(data.supervisor_id, companyId);
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
  return getCrewById(result.rows[0].id, companyId, user);
}

async function updateCrew(id, companyId, data, user) {
  const current = await getCrewById(id, companyId, user);
  if (data.name && data.name.toLowerCase() !== current.name.toLowerCase()) {
    await assertUniqueCrewName(companyId, data.name, id);
  }
  if (data.supervisor_id && data.supervisor_id !== current.supervisor_id) {
    await validateSupervisor(data.supervisor_id, companyId);
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

  return getCrewById(id, companyId, user);
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
            CONCAT_WS(' ', u.first_name, u.last_name) AS worker_name,
            u.email AS worker_email,
            w.personal_id,
            w.work_location_id,
            wl.name AS work_location_name
     FROM crew_workers cw
     JOIN workers w ON w.id = cw.worker_id
     JOIN users u ON u.id = w.user_id
     LEFT JOIN work_locations wl ON wl.id = w.work_location_id
     WHERE cw.crew_id = $1
       AND cw.company_id = $2
       AND cw.is_active = TRUE
       AND cw.unassigned_at IS NULL
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
