const request = require('supertest');
const app = require('../../src/app');
const profileService = require('../../src/services/profile-service/service');
const { query } = require('../../src/config/database');
const { ensureDemoWorkerUser, loginAsAdmin } = require('../helpers/auth.helper');

jest.setTimeout(30000);

describe('profile current contract', () => {
  test('GET y PATCH /api/profile/current exponen el contrato compatible para el front', async () => {
    const token = await loginAsAdmin(app);

    const getRes = await request(app)
      .get('/api/profile/current')
      .set('Authorization', `Bearer ${token}`);

    expect(getRes.statusCode).toBe(200);
    expect(getRes.body.success).toBe(true);
    expect(getRes.body.data).toHaveProperty('profile');
    expect(getRes.body.data).toHaveProperty('user');
    expect(getRes.body.data).toHaveProperty('worker');
    expect(getRes.body.data).toHaveProperty('security');
    expect(getRes.body.data).toHaveProperty('activity');
    expect(getRes.body.data.profile.security).toEqual(getRes.body.data.security);

    const patchRes = await request(app)
      .patch('/api/profile/current')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.body.success).toBe(true);
    expect(patchRes.body.data).toHaveProperty('profile');
    expect(patchRes.body.data).toHaveProperty('security');
    expect(patchRes.body.data.profile.security).toEqual(patchRes.body.data.security);
  });

  test('POST /api/profile/password usa el flujo de cambio de contrasena existente', async () => {
    const token = await loginAsAdmin(app);

    const res = await request(app)
      .post('/api/profile/password')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      error_code: 'MISSING_FIELDS'
    });
  });

  test('devuelve seguridad, trabajador, actividad y aliases esperados', async () => {
    await ensureDemoWorkerUser();

    const userRes = await query(`
      SELECT id, company_id
      FROM users
      WHERE email = 'trabajador@demo.com'
        AND deleted_at IS NULL
      LIMIT 1
    `);
    const user = userRes.rows[0];

    expect(user).toBeDefined();

    const profile = await profileService.getProfile(user.id, user.company_id, ['TRABAJADOR']);

    expect(profile).toHaveProperty('lastLoginAt');
    expect(profile).toHaveProperty('security');
    expect(profile.security).toMatchObject({
      email_verified: true,
      emailVerified: true,
      password_change_required: false,
      passwordChangeRequired: false,
      failed_login_attempts: 0,
      failedLoginAttempts: 0
    });
    expect(typeof profile.security.active_sessions).toBe('number');
    expect(profile.security.activeSessions).toBe(profile.security.active_sessions);
    expect(Array.isArray(profile.activity)).toBe(true);
    expect(profile.audit_logs).toBe(profile.activity);
    expect(profile.user).toMatchObject({
      id: user.id,
      userId: user.id,
      security: profile.security
    });
    expect(profile.worker).toMatchObject({
      userId: user.id,
      documentNumber: expect.any(String),
      laborStatus: 'active',
      hireDate: expect.any(String)
    });
    expect(profile.worker).toHaveProperty('crewName');
    expect(profile.worker).toHaveProperty('supervisorName');
    expect(profile.worker).toHaveProperty('branchName');
    expect(profile.worker).toHaveProperty('shiftName');
    expect(profile.worker).toHaveProperty('workerType');
    expect(profile.worker).toHaveProperty('modality');
    expect(profile.worker).toHaveProperty('costCenter');
  });

  test('resuelve cuadrilla desde obra cuando existe una unica cuadrilla activa', async () => {
    const candidateRes = await query(`
      SELECT u.id AS user_id,
             u.company_id,
             w.work_location_id,
             MIN(wc.id::text) AS crew_id,
             MIN(wc.name) AS crew_name
      FROM workers w
      JOIN users u ON u.id = w.user_id
      JOIN work_crews wc
        ON wc.company_id = w.company_id
       AND wc.work_location_id = w.work_location_id
       AND wc.deleted_at IS NULL
       AND COALESCE(wc.is_active, wc.status, TRUE) = TRUE
      WHERE w.deleted_at IS NULL
        AND w.work_location_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM crew_workers active_cw
          WHERE active_cw.worker_id = w.id
            AND active_cw.company_id = w.company_id
            AND active_cw.is_active = TRUE
            AND active_cw.unassigned_at IS NULL
        )
      GROUP BY u.id, u.company_id, w.work_location_id
      HAVING COUNT(wc.id)::int = 1
      LIMIT 1
    `);
    const candidate = candidateRes.rows[0];

    if (!candidate) {
      return;
    }

    const profile = await profileService.getProfile(candidate.user_id, candidate.company_id, ['TRABAJADOR']);

    expect(profile.worker.workLocationId).toBe(candidate.work_location_id);
    expect(profile.worker.crewId).toBe(candidate.crew_id);
    expect(profile.worker.crewName).toBe(candidate.crew_name);
  });
});
