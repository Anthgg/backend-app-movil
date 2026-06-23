const request = require('supertest');
const app = require('../../src/app');
const { query } = require('../../src/config/database');
const { getAccessToken } = require('../helpers/auth.helper');

describe('Worker onboarding API Tests', () => {
  let adminToken = '';
  let adminUserId = '';
  let companyId = '';
  let areaId = '';
  let positionId = '';
  let shiftId = '';
  let createdWorkerId = '';
  let createdUserId = '';
  let createdContractId = '';
  let existingInitialWorkerId = '';
  let existingInitialUserId = '';
  let existingInitialContractId = '';
  let mismatchUserId = '';
  const cleanupWorkerIds = [];
  const cleanupUserIds = [];
  const cleanupCrewIds = [];
  const cleanupWorkLocationIds = [];
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
        adminUserId = res.body.data.user.id;
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

  const ensureWorkLocationFixture = async () => {
    const existingLocation = await query(
      `SELECT id
       FROM work_locations
       WHERE company_id = $1
         AND deleted_at IS NULL
         AND COALESCE(is_active, status, TRUE) = TRUE
       ORDER BY created_at ASC
       LIMIT 1`,
      [companyId]
    );
    if (existingLocation.rows[0]?.id) {
      return existingLocation.rows[0].id;
    }

    const geoRes = await query(
      `SELECT gd.id AS department_id,
              gp.id AS province_id,
              gdi.id AS district_id
       FROM geographic_departments gd
       JOIN geographic_provinces gp ON gp.department_id = gd.id AND gp.deleted_at IS NULL
       JOIN geographic_districts gdi ON gdi.province_id = gp.id AND gdi.deleted_at IS NULL
       WHERE gd.deleted_at IS NULL
       ORDER BY gd.name ASC, gp.name ASC, gdi.name ASC
       LIMIT 1`
    );
    const geo = geoRes.rows[0];
    if (!geo) {
      return null;
    }

    const locationRes = await query(
      `INSERT INTO work_locations (
         company_id, name, address, geographic_department_id,
         geographic_province_id, geographic_district_id, is_active, status
       )
       VALUES ($1, $2, 'Ubicacion QA Onboarding', $3, $4, $5, TRUE, TRUE)
       RETURNING id`,
      [
        companyId,
        `Obra QA Onboarding ${Date.now()}`,
        geo.department_id,
        geo.province_id,
        geo.district_id
      ]
    );
    cleanupWorkLocationIds.push(locationRes.rows[0].id);
    return locationRes.rows[0].id;
  };

  const createCrewFixture = async (workLocationId) => {
    const crewRes = await query(
      `INSERT INTO work_crews (
         company_id, name, supervisor_id, work_location_id,
         is_active, status, created_by
       )
       VALUES ($1, $2, $3, $4, TRUE, TRUE, $3)
       RETURNING id`,
      [companyId, `Cuadrilla QA Onboarding ${Date.now()}`, adminUserId, workLocationId]
    );
    cleanupCrewIds.push(crewRes.rows[0].id);
    return crewRes.rows[0].id;
  };

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
    for (const workerId of cleanupWorkerIds) {
      await query('UPDATE users SET worker_id = NULL WHERE worker_id = $1', [workerId]);
      await query('UPDATE workers SET user_id = NULL WHERE id = $1', [workerId]);
      await query('DELETE FROM worker_documents WHERE worker_id = $1', [workerId]);
      await query('DELETE FROM contract_documents WHERE contract_id IN (SELECT id FROM worker_contracts WHERE worker_id = $1)', [workerId]);
      await query('DELETE FROM worker_contracts WHERE worker_id = $1', [workerId]);
      await query('DELETE FROM crew_workers WHERE worker_id = $1', [workerId]);
      await query('DELETE FROM worker_assignment_history WHERE worker_id = $1', [workerId]).catch(() => {});
    }
    for (const userId of cleanupUserIds) {
      await query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
      await query('DELETE FROM users WHERE id = $1', [userId]);
    }
    for (const workerId of cleanupWorkerIds) {
      await query('DELETE FROM workers WHERE id = $1', [workerId]);
    }
    for (const crewId of cleanupCrewIds) {
      await query('DELETE FROM worker_assignment_history WHERE previous_crew_id = $1 OR new_crew_id = $1', [crewId]).catch(() => {});
      await query('DELETE FROM crew_workers WHERE crew_id = $1', [crewId]);
      await query('DELETE FROM work_crews WHERE id = $1', [crewId]);
    }
    for (const workLocationId of cleanupWorkLocationIds) {
      await query('DELETE FROM work_locations WHERE id = $1', [workLocationId]);
    }

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
    if (existingInitialContractId) {
      await query('DELETE FROM contract_documents WHERE contract_id = $1', [existingInitialContractId]);
      await query('DELETE FROM worker_contracts WHERE id = $1', [existingInitialContractId]);
    }
    if (existingInitialWorkerId) {
      await query('UPDATE users SET worker_id = NULL WHERE worker_id = $1', [existingInitialWorkerId]);
      await query('UPDATE workers SET user_id = NULL WHERE id = $1', [existingInitialWorkerId]);
    }
    if (existingInitialUserId) {
      await query('DELETE FROM user_roles WHERE user_id = $1', [existingInitialUserId]);
      await query('DELETE FROM users WHERE id = $1', [existingInitialUserId]);
    }
    if (mismatchUserId) {
      await query('DELETE FROM users WHERE id = $1', [mismatchUserId]);
    }
    if (existingInitialWorkerId) {
      await query('DELETE FROM workers WHERE id = $1', [existingInitialWorkerId]);
    }
  }, 30000);

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
    expect(res.body.data.temporaryPassword || res.body.data.temporary_password).toBeTruthy();
    expect(res.body.data.forcePasswordChange || res.body.data.force_password_change).toBe(true);
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

  test('POST /api/workers/onboarding asigna trabajador a crewId enviado', async () => {
    if (!areaId || !positionId || !adminUserId) return;

    const workLocationId = await ensureWorkLocationFixture();
    if (!workLocationId) return;

    const crewId = await createCrewFixture(workLocationId);
    const testDni = String(74000000 + (Date.now() % 899999));
    const testUsername = `onboarding.crew.${testDni}`;
    const testEmail = `${testUsername}@fabryor.com`;

    const res = await request(app)
      .post('/api/workers/onboarding')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(onboardingPayload({
        personalData: {
          dni: testDni,
          personalEmail: `personal.${testDni}@example.com`
        },
        laborData: {
          workLocationId,
          crewId,
          requiresAttendance: false
        },
        contractData: {
          createContract: false
        },
        accessData: {
          username: testUsername,
          corporateEmail: testEmail,
          temporaryPassword: 'Fabryor@2026C!'
        }
      }));

    expect(res.statusCode).toEqual(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.worker_id).toBeTruthy();
    expect(res.body.data.user_id).toBeTruthy();
    expect(res.body.data.crew_id).toBe(crewId);
    expect(res.body.data.crewId).toBe(crewId);
    expect(res.body.data.work_location_id).toBe(workLocationId);

    cleanupWorkerIds.push(res.body.data.worker_id);
    cleanupUserIds.push(res.body.data.user_id);

    const memberRes = await query(
      `SELECT 1
       FROM crew_workers
       WHERE company_id = $1
         AND crew_id = $2
         AND worker_id = $3
         AND is_active = TRUE
         AND unassigned_at IS NULL`,
      [companyId, crewId, res.body.data.worker_id]
    );
    expect(memberRes.rowCount).toBe(1);

    const crewWorkersRes = await request(app)
      .get(`/api/work-crews/${crewId}/workers`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(crewWorkersRes.statusCode).toEqual(200);
    expect(crewWorkersRes.body.success).toBe(true);
    expect(crewWorkersRes.body.data.some((worker) => worker.worker_id === res.body.data.worker_id)).toBe(true);
  }, 30000);

  test('POST /api/workers/onboarding genera contrato inicial para trabajador existente sin duplicarlo', async () => {
    if (!areaId || !positionId || !shiftId) return;

    const existingDni = String(72000000 + (Date.now() % 899999));
    const workerRes = await query(`
      INSERT INTO workers (
        company_id, document_type, personal_id, document_number, first_name, paternal_last_name,
        area_id, position_id, job_position_id, shift_id, hire_date, start_date,
        status, employment_status, is_active
      )
      VALUES ($1, 'DNI', $2, $2, 'Contrato', 'Existente', $3, $4, $4, $5, '2026-06-03', '2026-06-03', 'ACTIVE', 'active', TRUE)
      RETURNING id
    `, [companyId, existingDni, areaId, positionId, shiftId]);
    existingInitialWorkerId = workerRes.rows[0].id;

    const userRes = await query(`
      INSERT INTO users (company_id, email, username, password_hash, first_name, last_name, full_name, is_active, status, worker_id)
      VALUES ($1, $2, $3, 'dummy-hash', 'Contrato', 'Existente', 'Contrato Existente', TRUE, 'active', $4)
      RETURNING id
    `, [companyId, `existing.${existingDni}@example.com`, `existing.${existingDni}`, existingInitialWorkerId]);
    existingInitialUserId = userRes.rows[0].id;
    await query('UPDATE workers SET user_id = $1 WHERE id = $2', [existingInitialUserId, existingInitialWorkerId]);

    const countBefore = await query('SELECT COUNT(*)::int AS total FROM workers WHERE company_id = $1', [companyId]);

    const res = await request(app)
      .post('/api/workers/onboarding')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        onboardingContext: {
          mode: 'create',
          workerId: existingInitialWorkerId,
          userId: existingInitialUserId
        },
        personalData: {
          phone: '944335792'
        },
        laborData: {
          companyId,
          areaId,
          positionId,
          shiftId,
          startDate: '2026-06-03',
          status: 'active'
        },
        contractData: {
          createContract: true,
          generateContract: false,
          contractType: 'temporal',
          startDate: '2026-06-03',
          salary: 1800
        },
        accessData: {
          createAccess: false
        }
      });

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.worker_id).toBe(existingInitialWorkerId);
    expect(res.body.data.workerId).toBe(existingInitialWorkerId);
    expect(res.body.data.user_id).toBe(existingInitialUserId);
    expect(res.body.data.userId).toBe(existingInitialUserId);
    expect(res.body.data.contract_id).toBeTruthy();
    expect(res.body.data.contractId).toBe(res.body.data.contract_id);
    expect(res.body.data.mode).toBe('create');

    existingInitialContractId = res.body.data.contract_id;
    const countAfter = await query('SELECT COUNT(*)::int AS total FROM workers WHERE company_id = $1', [companyId]);
    expect(countAfter.rows[0].total).toBe(countBefore.rows[0].total);

    const contractRes = await query(
      'SELECT worker_id FROM worker_contracts WHERE id = $1',
      [existingInitialContractId]
    );
    expect(contractRes.rows[0].worker_id).toBe(existingInitialWorkerId);
  }, 30000);

  test('POST /api/workers/onboarding rechaza workerId invalido en onboardingContext', async () => {
    const res = await request(app)
      .post('/api/workers/onboarding')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        onboardingContext: {
          mode: 'create',
          workerId: 'PENDIENTE-123'
        }
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('INVALID_WORKER_ID');
  });

  test('POST /api/workers/onboarding rechaza userId que no corresponde al worker', async () => {
    if (!existingInitialWorkerId || !existingInitialUserId) return;

    const otherDni = String(73000000 + (Date.now() % 899999));
    const otherUser = await query(`
      INSERT INTO users (company_id, email, username, password_hash, first_name, last_name, full_name, is_active, status)
      VALUES ($1, $2, $3, 'dummy-hash', 'Otro', 'Usuario', 'Otro Usuario', TRUE, 'active')
      RETURNING id
    `, [companyId, `mismatch.${otherDni}@example.com`, `mismatch.${otherDni}`]);
    mismatchUserId = otherUser.rows[0].id;

    const res = await request(app)
      .post('/api/workers/onboarding')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        onboardingContext: {
          mode: 'create',
          workerId: existingInitialWorkerId,
          userId: mismatchUserId
        },
        contractData: {
          createContract: true,
          generateContract: false
        }
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('WORKER_USER_MISMATCH');
  });

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
    expect(res.body.data.forcePasswordChange).toBe(true);
    expect(res.body.data.mustChangePassword).toBe(true);
    expect(res.body.data.passwordChangeRequired).toBe(true);
    expect(res.body.data.force_password_change).toBe(true);
    expect(res.body.data.password_change_required).toBe(true);
    expect(res.body.data.user.forcePasswordChange).toBe(true);
    expect(res.body.data.user.mustChangePassword).toBe(true);
    expect(res.body.data.user.passwordChangeRequired).toBe(true);
    expect(res.body.data.user.force_password_change).toBe(true);
    expect(res.body.data.user.password_change_required).toBe(true);
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
