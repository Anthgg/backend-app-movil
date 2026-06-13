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
    expect(getRes.body).toHaveProperty('profile');
    expect(getRes.body).toHaveProperty('user');
    expect(getRes.body).toHaveProperty('worker');
    expect(getRes.body).toHaveProperty('security');
    expect(getRes.body).toHaveProperty('activity');
    expect(getRes.body).toHaveProperty('logs');
    expect(getRes.body.data).toHaveProperty('profile');
    expect(getRes.body.data).toHaveProperty('user');
    expect(getRes.body.data).toHaveProperty('worker');
    expect(getRes.body.data).toHaveProperty('security');
    expect(getRes.body.data).toHaveProperty('activity');
    expect(getRes.body.data.profile.security).toEqual(getRes.body.data.security);
    expect(getRes.body.profile).toEqual(getRes.body.data.profile);
    expect(getRes.body.security).toEqual(getRes.body.data.security);
    expect(Array.isArray(getRes.body.permissions)).toBe(true);
    expect(Array.isArray(getRes.body.permissionsByModule)).toBe(true);

    const patchRes = await request(app)
      .patch('/api/profile/current')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.body.success).toBe(true);
    expect(patchRes.body).toHaveProperty('profile');
    expect(patchRes.body.data).toHaveProperty('profile');
    expect(patchRes.body.data).toHaveProperty('security');
    expect(patchRes.body.data.profile.security).toEqual(patchRes.body.data.security);
    expect(patchRes.body.profile).toEqual(patchRes.body.data.profile);
  });

  test('GET /api/profile/current no devuelve URL local si el archivo de foto ya no existe', async () => {
    const token = await loginAsAdmin(app);

    await query(`
      UPDATE users
      SET profile_photo_url = 'https://backend-app-movil-177686674468.europe-west1.run.app/uploads/profiles/no-existe-test.png'
      WHERE email = 'admin@demo.com'
    `);

    const res = await request(app)
      .get('/api/profile/current')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.profile.profilePhotoUrl).toBeNull();
    expect(res.body.profile.avatarUrl).toBeNull();

    await query("UPDATE users SET profile_photo_url = NULL WHERE email = 'admin@demo.com'");
  });

  test('GET /api/profile/sessions lista sesiones sin exponer tokens ni hashes', async () => {
    const token = await loginAsAdmin(app);

    const res = await request(app)
      .get('/api/profile/sessions')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.sessions)).toBe(true);
    res.body.data.sessions.forEach((session) => {
      expect(session).toHaveProperty('id');
      expect(session).toHaveProperty('isCurrent');
      expect(session).toHaveProperty('canTrust');
      expect(session).not.toHaveProperty('refreshToken');
      expect(session).not.toHaveProperty('refresh_token_hash');
      expect(session).not.toHaveProperty('refreshTokenHash');
    });
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
      code: 'MISSING_FIELDS',
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

    const profile = await profileService.getProfile(user.id, user.company_id, ['TRABAJADOR'], ['dashboard.read', 'profile.read']);

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
    expect(profile.logs).toBe(profile.activity);
    expect(profile.permissions).toEqual(['dashboard.read', 'profile.read']);
    expect(profile.permissionsByModule).toEqual([
      expect.objectContaining({ module: 'dashboard', access: 'read' }),
      expect.objectContaining({ module: 'profile', access: 'read' })
    ]);
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
    expect(profile).toHaveProperty('documentNumber', profile.worker.documentNumber);
    expect(profile).toHaveProperty('personalId', profile.worker.personalId);
    expect(profile).toHaveProperty('gender');
    expect(profile).toHaveProperty('civilStatus');
    expect(profile).toHaveProperty('nationality');
    expect(profile).toHaveProperty('province');
    expect(profile).toHaveProperty('district');
    expect(profile).toHaveProperty('departmentGeo');
    expect(profile).toHaveProperty('emergencyContactRelationship');
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

  test('devuelve datos personales completos cuando el worker los tiene registrados en BD', async () => {
    await ensureDemoWorkerUser();

    // 1. Obtener el usuario de prueba
    const userRes = await query(`
      SELECT id, company_id
      FROM users
      WHERE email = 'trabajador@demo.com'
        AND deleted_at IS NULL
      LIMIT 1
    `);
    const user = userRes.rows[0];
    expect(user).toBeDefined();

    // 2. Obtener o insertar datos geográficos de prueba para ubigeo
    const depRes = await query(`SELECT id, name FROM geographic_departments WHERE deleted_at IS NULL LIMIT 1`);
    const dep = depRes.rows[0];
    let prov = null;
    let dist = null;
    if (dep) {
      const provRes = await query(`SELECT id, name FROM geographic_provinces WHERE department_id = $1 AND deleted_at IS NULL LIMIT 1`, [dep.id]);
      prov = provRes.rows[0];
      if (prov) {
        const distRes = await query(`SELECT id, name FROM geographic_districts WHERE province_id = $1 AND deleted_at IS NULL LIMIT 1`, [prov.id]);
        dist = distRes.rows[0];
      }
    }

    // 3. Actualizar la base de datos del worker con datos reales completos
    await query(`
      UPDATE workers
      SET birth_date = '2003-05-26',
          gender = 'female',
          civil_status = 'single',
          nationality = 'Peruana',
          address = 'Calle Principal 123',
          department_id = $1,
          province_id = $2,
          district_id = $3,
          department = NULL,
          province = NULL,
          district = NULL,
          emergency_contact_name = 'Nombre Contacto',
          emergency_contact_phone = '999999999',
          emergency_contact_relationship = 'Madre'
      WHERE user_id = $4
    `, [
      dep ? dep.id : null,
      prov ? prov.id : null,
      dist ? dist.id : null,
      user.id
    ]);

    // 4. Invocar el endpoint a través del servicio
    const profile = await profileService.getProfile(user.id, user.company_id, ['TRABAJADOR']);

    // 5. Validaciones de contrato
    expect(profile.birthDate || profile.worker?.birthDate).toBe('2003-05-26');
    expect(profile.gender || profile.worker?.gender).toBe('female');
    expect(profile.genderLabel || profile.worker?.genderLabel).toBe('Femenino');
    expect(profile.civilStatus || profile.worker?.civilStatus).toBe('single');
    expect(profile.civilStatusLabel || profile.worker?.civilStatusLabel).toBe('Soltero');
    expect(profile.nationality || profile.worker?.nationality).toBe('Peruana');
    expect(profile.address || profile.worker?.address).toBe('Calle Principal 123');

    if (dep) {
      expect(profile.departmentGeo || profile.worker?.departmentGeo).toBe(dep.name);
    }
    if (prov) {
      expect(profile.province || profile.worker?.province).toBe(prov.name);
    }
    if (dist) {
      expect(profile.district || profile.worker?.district).toBe(dist.name);
    }

    expect(profile.emergencyContactName || profile.worker?.emergencyContactName).toBe('Nombre Contacto');
    expect(profile.emergencyContactPhone || profile.worker?.emergencyContactPhone).toBe('999999999');
    expect(profile.emergencyContactRelationship || profile.worker?.emergencyContactRelationship).toBe('Madre');
  });
});
