const request = require('supertest');
const app = require('../../src/app');
const { query } = require('../../src/config/database');
const { getAccessToken } = require('../helpers/auth.helper');

describe('Worker onboarding API Tests', () => {
  let adminToken = '';
  let companyId = '';
  let areaId = '';
  let positionId = '';
  let shiftId = '';
  let createdWorkerId = '';
  let createdUserId = '';
  let createdContractId = '';
  const dni = String(71000000 + (Date.now() % 899999));
  const username = `onboarding.${dni}`;
  const corporateEmail = `onboarding.${dni}@fabryor.com`;

  const ensureLaborCatalogFixtures = async () => {
    const existingArea = await query(
      `SELECT id FROM areas
       WHERE company_id = $1
         AND deleted_at IS NULL
         AND COALESCE(is_active, status, TRUE) = TRUE
       ORDER BY created_at ASC
       LIMIT 1`,
      [companyId]
    );

    areaId = existingArea.rows[0]?.id;
    if (!areaId) {
      const insertedArea = await query(
        `INSERT INTO areas (company_id, name, description, is_active, status)
         VALUES ($1, 'QA Onboarding', 'Area laboral para pruebas de onboarding', TRUE, TRUE)
         RETURNING id`,
        [companyId]
      );
      areaId = insertedArea.rows[0].id;
    }

    const existingPosition = await query(
      `SELECT id FROM job_positions
       WHERE company_id = $1
         AND area_id = $2
         AND deleted_at IS NULL
         AND COALESCE(is_active, status, TRUE) = TRUE
       ORDER BY created_at ASC
       LIMIT 1`,
      [companyId, areaId]
    );

    positionId = existingPosition.rows[0]?.id;
    if (!positionId) {
      const insertedPosition = await query(
        `INSERT INTO job_positions (company_id, area_id, name, description, is_active, status)
         VALUES ($1, $2, 'Trabajador QA Onboarding', 'Puesto laboral para pruebas de onboarding', TRUE, TRUE)
         RETURNING id`,
        [companyId, areaId]
      );
      positionId = insertedPosition.rows[0].id;
    }
  };

  const loginWithFallback = async () => {
    const candidates = [
      { email: 'admin.qa@demo.com', password: 'AdminDemo2026!' },
      { email: 'admin@demo.com', password: 'Demo123!' }
    ];

    for (const candidate of candidates) {
      const res = await request(app).post('/auth/login').send(candidate);
      const token = getAccessToken(res.body);
      if (res.statusCode === 200 && token) {
        companyId = res.body.data.user.companyId;
        return token;
      }
    }

    throw new Error('No se pudo autenticar con usuario admin demo.');
  };

  const onboardingPayload = (overrides = {}) => ({
    personalData: {
      dni,
      firstName: 'Jose Luis',
      paternalLastName: 'Perez',
      maternalLastName: 'Alvarez',
      birthDate: '1995-05-12',
      gender: 'male',
      civilStatus: 'single',
      nationality: 'Peruana',
      phone: '947399633',
      personalEmail: `personal.${dni}@example.com`,
      address: 'Villa El Salvador',
      emergencyContactName: 'Maria Alvarez',
      emergencyContactPhone: '999888777',
      ...(overrides.personalData || {})
    },
    laborData: {
      companyId,
      areaId,
      positionId,
      shiftId,
      startDate: '2026-05-20',
      status: 'active',
      ...(overrides.laborData || {})
    },
    contractData: {
      generateContract: false,
      contractType: 'temporal',
      startDate: '2026-05-20',
      endDate: '2026-11-20',
      trialPeriod: true,
      salary: 1800,
      currency: 'PEN',
      workdayType: 'full_time',
      workMode: 'onsite',
      observations: 'Contrato inicial QA',
      ...(overrides.contractData || {})
    },
    accessData: {
      createAccess: true,
      role: 'TRABAJADOR',
      username,
      corporateEmail,
      temporaryPassword: 'Fabryor@2026T!',
      forcePasswordChange: true,
      sendCredentialsByEmail: false,
      ...(overrides.accessData || {})
    }
  });

  beforeAll(async () => {
    adminToken = await loginWithFallback();

    const [shiftRes] = await Promise.all([
      query(
        `SELECT id FROM shifts
         WHERE company_id = $1
         ORDER BY created_at ASC
         LIMIT 1`,
        [companyId]
      )
    ]);

    await ensureLaborCatalogFixtures();
    shiftId = shiftRes.rows[0]?.id;
  }, 30000);

  afterAll(async () => {
    if (createdWorkerId) {
      await query('UPDATE users SET worker_id = NULL WHERE worker_id = $1', [createdWorkerId]);
      await query('UPDATE workers SET user_id = NULL WHERE id = $1', [createdWorkerId]);
      await query('DELETE FROM worker_documents WHERE worker_id = $1', [createdWorkerId]);
      if (createdContractId) {
        await query('DELETE FROM contract_documents WHERE contract_id = $1', [createdContractId]);
      }
      await query('DELETE FROM worker_contracts WHERE worker_id = $1', [createdWorkerId]);
    }
    if (createdUserId) {
      await query('DELETE FROM user_roles WHERE user_id = $1', [createdUserId]);
      await query('DELETE FROM users WHERE id = $1', [createdUserId]);
    }
    if (createdWorkerId) {
      await query('DELETE FROM workers WHERE id = $1', [createdWorkerId]);
    }
  });

  test('POST /api/users/suggest-credentials sugiere credenciales corporativas', async () => {
    const res = await request(app)
      .post('/api/users/suggest-credentials')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        company_id: companyId,
        first_name: 'Jose Luis',
        paternal_last_name: 'Perez',
        maternal_last_name: 'Alvarez'
      });

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.username).toBeTruthy();
    expect(res.body.data.corporate_email).toMatch(/@fabryor\.com$/);
    expect(res.body.data.temporary_password).toBeUndefined();
    expect(res.body.data.force_password_change).toBe(true);
  });

  test('POST /api/workers/onboarding crea trabajador, usuario y contrato', async () => {
    if (!areaId || !positionId || !shiftId) return;

    const res = await request(app)
      .post('/api/workers/onboarding')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(onboardingPayload());

    expect(res.statusCode).toEqual(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.worker_id).toBeTruthy();
    expect(res.body.data.user_id).toBeTruthy();
    expect(res.body.data.contract_id).toBeTruthy();
    expect(res.body.data.temporary_password).toBeUndefined();

    createdWorkerId = res.body.data.worker_id;
    createdUserId = res.body.data.user_id;
    createdContractId = res.body.data.contract_id;
  }, 30000);

  test('GET /api/workers/:workerId/onboarding-status retorna pasos pendientes', async () => {
    if (!createdWorkerId) return;

    const res = await request(app)
      .get(`/api/workers/${createdWorkerId}/onboarding-status`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.worker_created).toBe(true);
    expect(res.body.data.user_created).toBe(true);
    expect(res.body.data.contract_created).toBe(true);
    expect(res.body.data.signed_contract_uploaded).toBe(false);
    expect(res.body.data.pending_steps).toContain('signed_contract_upload');
  });

  test('POST /auth/login permite acceder con username temporal y marca cambio de contrasena', async () => {
    if (!createdUserId) return;

    const res = await request(app)
      .post('/auth/login')
      .send({ username, password: 'Fabryor@2026T!' });

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.username).toBe(username);
    expect(res.body.data.user.forcePasswordChange).toBe(true);
    expect(res.body.data.user.mustChangePassword).toBe(true);
  });

  test('POST /api/workers/onboarding rechaza DNI duplicado', async () => {
    if (!createdWorkerId) return;

    const res = await request(app)
      .post('/api/workers/onboarding')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(onboardingPayload({
        accessData: { createAccess: false },
        contractData: { createContract: false }
      }));

    expect(res.statusCode).toEqual(409);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('DNI_ALREADY_EXISTS');
  });

  test('POST /api/workers/onboarding rechaza tenant incorrecto', async () => {
    const res = await request(app)
      .post('/api/workers/onboarding')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(onboardingPayload({
        personalData: { dni: String(Number(dni) + 1).padStart(8, '0') },
        laborData: { companyId: '00000000-0000-4000-8000-000000000000' },
        accessData: { createAccess: false },
        contractData: { createContract: false }
      }));

    expect(res.statusCode).toEqual(403);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('TENANT_MISMATCH');
  });

  test('POST /api/workers/:workerId/contracts/signed rechaza archivo exe', async () => {
    if (!createdWorkerId || !createdContractId) return;

    const res = await request(app)
      .post(`/api/workers/${createdWorkerId}/contracts/signed`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('contract_id', createdContractId)
      .attach('file', Buffer.from('not an allowed file'), 'contrato.exe');

    expect(res.statusCode).toEqual(415);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('INVALID_FILE_TYPE');
  });

  test('POST /api/workers/:workerId/contracts/signed rechaza archivo mayor a 10MB', async () => {
    if (!createdWorkerId || !createdContractId) return;

    const oversizedPdf = Buffer.alloc((10 * 1024 * 1024) + 1, 0);
    const res = await request(app)
      .post(`/api/workers/${createdWorkerId}/contracts/signed`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('contract_id', createdContractId)
      .attach('file', oversizedPdf, 'contrato-grande.pdf');

    expect(res.statusCode).toEqual(413);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('FILE_TOO_LARGE');
  });

  test('POST /api/workers/:workerId/contracts/signed sube contrato firmado PDF', async () => {
    if (!createdWorkerId || !createdContractId) return;

    const signedPdf = Buffer.from('%PDF-1.4 signed contract test');
    const res = await request(app)
      .post(`/api/workers/${createdWorkerId}/contracts/signed`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('contract_id', createdContractId)
      .field('signed_at', '2026-05-20')
      .attach('file', signedPdf, 'contrato-firmado.pdf');

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.contract_id).toBe(createdContractId);
    expect(res.body.data.signed_file_url).toMatch(/^https?:\/\//);

    const statusRes = await request(app)
      .get(`/api/workers/${createdWorkerId}/onboarding-status`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(statusRes.statusCode).toEqual(200);
    expect(statusRes.body.data.signed_contract_uploaded).toBe(true);
  }, 30000);

  test('POST /api/workers/onboarding rechaza labels o formatos no-UUID en campos relacionales', async () => {
    const invalidPayload = onboardingPayload({
      laborData: {
        areaId: 'Sistemas',
        positionId: 'Desarrollador',
        branchId: 'Sede Principal'
      },
      contractData: {
        costCenterId: 'CC-OPER-01'
      }
    });

    const res = await request(app)
      .post('/api/workers/onboarding')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(invalidPayload);

    expect(res.statusCode).toEqual(422);
    expect(res.body.success).toBe(false);
    expect(res.body.errorCode).toBe('VALIDATION_FAILED');
    expect(res.body.errors.some(e => e.field === 'laborData.areaId')).toBe(true);
    expect(res.body.errors.some(e => e.field === 'laborData.positionId')).toBe(true);
    expect(res.body.errors.some(e => e.field === 'laborData.branchId')).toBe(true);
    expect(res.body.errors.some(e => e.field === 'contractData.costCenterId')).toBe(true);
  });

  test('POST /api/workers/onboarding rechaza UUIDs inexistentes en base de datos', async () => {
    const nonExistentUuid = '99999999-9999-4999-9999-999999999999';
    const invalidPayload = onboardingPayload({
      laborData: {
        areaId: nonExistentUuid,
        positionId: nonExistentUuid,
        branchId: nonExistentUuid,
        shiftId: nonExistentUuid,
        supervisorId: nonExistentUuid,
        workerTypeId: nonExistentUuid
      },
      contractData: {
        costCenterId: nonExistentUuid
      }
    });

    const res = await request(app)
      .post('/api/workers/onboarding')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(invalidPayload);

    expect(res.statusCode).toEqual(422);
    expect(res.body.success).toBe(false);
    expect(res.body.errorCode).toBe('VALIDATION_FAILED');
    expect(res.body.errors.some(e => e.field === 'laborData.areaId')).toBe(true);
    expect(res.body.errors.some(e => e.field === 'laborData.positionId')).toBe(true);
    expect(res.body.errors.some(e => e.field === 'laborData.branchId')).toBe(true);
    expect(res.body.errors.some(e => e.field === 'laborData.shiftId')).toBe(true);
    expect(res.body.errors.some(e => e.field === 'laborData.supervisorId')).toBe(true);
    expect(res.body.errors.some(e => e.field === 'laborData.workerTypeId')).toBe(true);
    expect(res.body.errors.some(e => e.field === 'contractData.costCenterId')).toBe(true);
  });

  test('GET /api/workers/catalogs retorna opciones reales con UUID', async () => {
    const catalogs = ['companies', 'branches', 'areas', 'positions', 'types', 'shifts', 'supervisors'];
    
    for (const catalog of catalogs) {
      const res = await request(app)
        .get(`/api/workers/${catalog}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toEqual(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      if (res.body.data.length > 0) {
        expect(res.body.data[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
        expect(res.body.data[0].name).toBeTruthy();
      }
    }
  });

  test('GET /api/contracts/cost-centers retorna opciones reales con UUID', async () => {
    const res = await request(app)
      .get('/api/contracts/cost-centers')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(res.body.data[0].code).toBeTruthy();
    expect(res.body.data[0].name).toBeTruthy();
  });
});
