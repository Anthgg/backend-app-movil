/**
 * Integration tests — Asignaciones temporales de trabajadores
 *
 * Cubre los 6 casos del bug report:
 * 1. Registrar asignación temporal
 * 2. Verificar active_assignment devuelve source = "temporary_assignment"
 * 3. GET /work-crews/:crewId/workers refleja el traslado
 * 4. GET /work-crews devuelve temporarily_moved_workers_count > 0
 * 5. Asignación vencida ya no cuenta
 * 6. Asignación con end_date = CURRENT_DATE sigue activa durante el día
 */

const request = require('supertest');
const app = require('../../src/app');
const { query } = require('../../src/config/database');
const { getAccessToken } = require('../helpers/auth.helper');

describe('Worker Temporary Location Assignments', () => {
  let adminToken = '';
  let companyId = '';
  let workerId = '';
  let crewId = '';
  let originWorkLocationId = '';
  let targetWorkLocationId = '';
  let createdAssignmentId = '';

  const loginWithFallback = async () => {
    const candidates = [
      { email: 'admin.qa@demo.com', password: 'AdminDemo2026!' },
      { email: 'admin@demo.com', password: 'Demo123!' },
    ];
    for (const cand of candidates) {
      const res = await request(app).post('/auth/login').send(cand);
      const token = getAccessToken(res.body);
      if (res.statusCode === 200 && token) {
        companyId = res.body.data.user.companyId;
        return token;
      }
    }
    throw new Error('No se pudo autenticar con usuario admin demo.');
  };

  beforeAll(async () => {
    adminToken = await loginWithFallback();

    // 1. Find a crew with at least one active worker
    const crewRes = await query(
      `SELECT wc.id AS crew_id, wc.work_location_id
       FROM work_crews wc
       JOIN crew_workers cw ON cw.crew_id = wc.id AND cw.company_id = wc.company_id
         AND cw.is_active = TRUE AND cw.unassigned_at IS NULL
       WHERE wc.company_id = $1 AND wc.deleted_at IS NULL
         AND COALESCE(wc.is_active, wc.status, TRUE) = TRUE
       GROUP BY wc.id, wc.work_location_id
       HAVING COUNT(cw.id) >= 1
       LIMIT 1`,
      [companyId]
    );
    if (crewRes.rowCount === 0) throw new Error('Prerequisito: se requiere al menos una cuadrilla con trabajadores activos.');
    crewId = crewRes.rows[0].crew_id;
    originWorkLocationId = crewRes.rows[0].work_location_id;

    // 2. Get a worker from that crew
    const workerRes = await query(
      `SELECT cw.worker_id FROM crew_workers cw
       WHERE cw.crew_id = $1 AND cw.company_id = $2
         AND cw.is_active = TRUE AND cw.unassigned_at IS NULL
       LIMIT 1`,
      [crewId, companyId]
    );
    if (workerRes.rowCount === 0) throw new Error('Prerequisito: se requiere un trabajador en la cuadrilla.');
    workerId = workerRes.rows[0].worker_id;

    // 3. Find a second work location (different from the crew's)
    const locRes = await query(
      `SELECT id FROM work_locations
       WHERE company_id = $1
         AND deleted_at IS NULL
         AND COALESCE(is_active, status, TRUE) = TRUE
         AND id <> $2
       LIMIT 1`,
      [companyId, originWorkLocationId]
    );
    if (locRes.rowCount === 0) throw new Error('Prerequisito: se requiere una segunda work_location activa.');
    targetWorkLocationId = locRes.rows[0].id;

    // 4. Cancel any pre-existing temporary assignment for this worker
    await query(
      `UPDATE worker_location_assignments
       SET is_active = FALSE, updated_at = NOW()
       WHERE worker_id = $1 AND company_id = $2
         AND assignment_type = 'temporary' AND is_active = TRUE`,
      [workerId, companyId]
    );
  }, 30000);

  afterAll(async () => {
    // Cleanup: deactivate any assignment created by these tests
    if (createdAssignmentId) {
      await query(
        `UPDATE worker_location_assignments
         SET is_active = FALSE, updated_at = NOW()
         WHERE id = $1`,
        [createdAssignmentId]
      );
    }
  });

  // ----------------------------------------------------------------
  // Caso 1: Registrar asignación temporal
  // ----------------------------------------------------------------
  test('Caso 1 — PUT /workers/:workerId/labor-assignment registra traslado temporal', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 14);
    const endDate = tomorrow.toISOString().slice(0, 10);

    const res = await request(app)
      .put(`/api/workers/${workerId}/labor-assignment`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        work_location_id: targetWorkLocationId,
        assignment_type: 'temporary',
        reason: 'Apoyo temporal por alta demanda (test)',
        end_date: endDate,
        auto_return: true,
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.assignment_type).toBe('temporary');
    expect(res.body.data.is_active).toBe(true);

    createdAssignmentId = res.body.data.id;
  });

  // ----------------------------------------------------------------
  // Caso 2: Ubicación activa → source = "temporary_assignment"
  // ----------------------------------------------------------------
  test('Caso 2 — GET /workers/:workerId/location-assignment/active devuelve temporary_assignment', async () => {
    const res = await request(app)
      .get(`/api/workers/${workerId}/location-assignment/active`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.source).toBe('temporary_assignment');
    expect(res.body.data.work_location.id).toBe(targetWorkLocationId);
    expect(res.body.data.assignment).toBeDefined();
    expect(res.body.data.assignment.type).toBe('temporary');
    expect(res.body.data.assignment.end_date).toBeDefined();
    // workerId alias presente
    expect(res.body.data.workerId ?? res.body.data.worker_id).toBe(workerId);
  });

  // ----------------------------------------------------------------
  // Caso 3: GET /work-crews/:crewId/workers → active_assignment correcto
  // ----------------------------------------------------------------
  test('Caso 3 — GET /work-crews/:crewId/workers refleja traslado temporal del trabajador', async () => {
    const res = await request(app)
      .get(`/api/work-crews/${crewId}/workers`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const workerRow = res.body.data.find(
      (w) => w.worker_id === workerId || w.id === workerId
    );
    expect(workerRow).toBeDefined();

    const aa = workerRow.active_assignment;
    expect(aa).toBeDefined();
    expect(aa.source).toBe('temporary_assignment');
    expect(aa.work_location_id).toBe(targetWorkLocationId);
    expect(aa.work_location_name).toBeTruthy();
    expect(aa.start_date).toBeTruthy();
    expect(aa.end_date).toBeTruthy();
  });

  // ----------------------------------------------------------------
  // Caso 4: GET /work-crews → temporarily_moved_workers_count > 0
  // ----------------------------------------------------------------
  test('Caso 4 — GET /work-crews incluye temporarily_moved_workers_count correcto', async () => {
    const res = await request(app)
      .get('/api/work-crews')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const crew = res.body.data.find((c) => c.id === crewId);
    expect(crew).toBeDefined();

    const count =
      crew.temporarily_moved_workers_count ??
      crew.temporarilyMovedWorkersCount ??
      0;
    expect(count).toBeGreaterThanOrEqual(1);
  });

  // ----------------------------------------------------------------
  // Caso 5: Asignación vencida no cuenta
  // ----------------------------------------------------------------
  test('Caso 5 — Asignación con end_date pasado no aparece como activa', async () => {
    // Insert a past assignment directly
    const pastEndDate = '2020-01-01';
    const insertRes = await query(
      `INSERT INTO worker_location_assignments
         (company_id, worker_id, work_location_id, assigned_by, assignment_type,
          start_date, end_date, reason, is_active)
       VALUES ($1,$2,$3,$2,'temporary','2020-01-01',$4,'test-past',TRUE)
       RETURNING id`,
      [companyId, workerId, targetWorkLocationId, pastEndDate]
    );
    const pastId = insertRes.rows[0].id;

    const activeRes = await request(app)
      .get(`/api/workers/${workerId}/location-assignment/active`)
      .set('Authorization', `Bearer ${adminToken}`);

    // The past-expired one should NOT be the result
    if (activeRes.body.data?.assignment?.id) {
      expect(activeRes.body.data.assignment.id).not.toBe(pastId);
    }

    // Cleanup
    await query('UPDATE worker_location_assignments SET is_active=FALSE WHERE id=$1', [pastId]);
  });

  // ----------------------------------------------------------------
  // Caso 6: Asignación con end_date = hoy sigue activa
  // ----------------------------------------------------------------
  test('Caso 6 — Asignación con end_date = CURRENT_DATE sigue vigente durante el día', async () => {
    // Temporarily update the created assignment to end today
    const today = new Date().toISOString().slice(0, 10);
    if (!createdAssignmentId) return;

    await query(
      `UPDATE worker_location_assignments SET end_date = $1 WHERE id = $2`,
      [today, createdAssignmentId]
    );

    const res = await request(app)
      .get(`/api/workers/${workerId}/location-assignment/active`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.source).toBe('temporary_assignment');
  });
});
