const request = require('supertest');
const app = require('../../src/app');
const { query } = require('../../src/config/database');
const { getAccessToken } = require('../helpers/auth.helper');

describe('Onboarding Prefill API Tests', () => {
  let adminToken = '';
  let companyId = '';
  let validWorkerId = '';
  let validUserIdWithWorker = '';
  let validUserIdWithoutWorker = '';
  let workerIdFromOtherTenant = '';
  let createdTempUserId = '';
  let createdTempCompanyId = '';
  let createdTempWorkerIdFromOtherTenant = '';

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

  beforeAll(async () => {
    adminToken = await loginWithFallback();

    // 1. Find a valid worker and user belonging to the logged-in company
    const workerRes = await query(`
      SELECT w.id as worker_id, u.id as user_id
      FROM workers w
      JOIN users u ON w.user_id = u.id
      WHERE w.company_id = $1 AND w.deleted_at IS NULL AND u.deleted_at IS NULL
      LIMIT 1
    `, [companyId]);

    if (workerRes.rowCount > 0) {
      validWorkerId = workerRes.rows[0].worker_id;
      validUserIdWithWorker = workerRes.rows[0].user_id;
    } else {
      throw new Error(`Requisito previo fallido: Debe existir al menos un trabajador para la empresa ${companyId}`);
    }

    // 2. Find a user without a worker
    const userRes = await query(`
      SELECT u.id as user_id
      FROM users u
      LEFT JOIN workers w ON w.user_id = u.id AND w.deleted_at IS NULL
      WHERE u.company_id = $1 AND u.deleted_at IS NULL AND w.id IS NULL
      LIMIT 1
    `, [companyId]);

    if (userRes.rowCount > 0) {
      validUserIdWithoutWorker = userRes.rows[0].user_id;
    } else {
      // Create a temporary user without a worker
      const newDni = String(92000000 + (Date.now() % 899999));
      const username = `prefill.test.${newDni}`;
      const email = `prefill.test.${newDni}@example.com`;
      const insertUserRes = await query(`
        INSERT INTO users (company_id, first_name, last_name, email, username, password_hash, is_active)
        VALUES ($1, 'Juan Prefill', 'Perez', $2, $3, 'dummy-hash', TRUE)
        RETURNING id
      `, [companyId, email, username]);
      validUserIdWithoutWorker = insertUserRes.rows[0].id;
      createdTempUserId = validUserIdWithoutWorker;
    }

    // 3. Find/Create a worker from another tenant
    const otherTenantWorkerRes = await query(`
      SELECT id FROM workers 
      WHERE company_id != $1 AND deleted_at IS NULL 
      LIMIT 1
    `, [companyId]);

    if (otherTenantWorkerRes.rowCount > 0) {
      workerIdFromOtherTenant = otherTenantWorkerRes.rows[0].id;
    } else {
      // Create a temporary company and a worker in it
      const insertCompanyRes = await query(`
        INSERT INTO companies (name, document_number, is_active)
        VALUES ('Temp Prefill Company', '10101010101', TRUE)
        RETURNING id
      `);
      createdTempCompanyId = insertCompanyRes.rows[0].id;

      const newDni = String(93000000 + (Date.now() % 899999));
      const username = `prefill.other.${newDni}`;
      const email = `prefill.other.${newDni}@example.com`;

      const insertOtherUserRes = await query(`
        INSERT INTO users (company_id, first_name, last_name, email, username, password_hash, is_active)
        VALUES ($1, 'Otro Tenant', 'Trabajador', $2, $3, 'dummy-hash', TRUE)
        RETURNING id
      `, [createdTempCompanyId, email, username]);
      const otherUserId = insertOtherUserRes.rows[0].id;

      const insertOtherWorkerRes = await query(`
        INSERT INTO workers (user_id, company_id, personal_id, first_name, paternal_last_name, is_active)
        VALUES ($1, $2, $3, 'Otro Tenant', 'Trabajador', TRUE)
        RETURNING id
      `, [otherUserId, createdTempCompanyId, newDni]);
      createdTempWorkerIdFromOtherTenant = insertOtherWorkerRes.rows[0].id;
      workerIdFromOtherTenant = createdTempWorkerIdFromOtherTenant;
    }
  }, 30000);

  afterAll(async () => {
    // Clean up temporary resources
    if (createdTempUserId) {
      await query('DELETE FROM users WHERE id = $1', [createdTempUserId]);
    }
    if (createdTempWorkerIdFromOtherTenant) {
      await query('DELETE FROM workers WHERE id = $1', [createdTempWorkerIdFromOtherTenant]);
    }
    if (createdTempCompanyId) {
      await query('DELETE FROM users WHERE company_id = $1', [createdTempCompanyId]);
      await query('DELETE FROM companies WHERE id = $1', [createdTempCompanyId]);
    }
  });

  test('1. Valid workerId', async () => {
    const res = await request(app)
      .get(`/api/workers/onboarding-prefill?workerId=${validWorkerId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.sourceWorkerId).toEqual(validWorkerId);
    expect(res.body.data.sourceUserId).toBeTruthy();
    expect(res.body.data.personalData).toBeDefined();
    expect(res.body.data.laborData).toBeDefined();
    expect(res.body.data.accessData).toBeDefined();
    expect(res.body.data.missingFields).toBeDefined();

    const accessRes = await query(`
      SELECT u.username,
             u.email AS corporate_email,
             role_data.role_id,
             role_data.role_name,
             role_data.role_code
      FROM users u
      LEFT JOIN LATERAL (
        SELECT ur.role_id,
               r.name AS role_name,
               r.code AS role_code
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
      LIMIT 1
    `, [validUserIdWithWorker, companyId]);
    const expectedAccess = accessRes.rows[0] || {};

    expect(res.body.data.accessData).toEqual({
      roleId: expectedAccess.role_id || null,
      role: expectedAccess.role_code || expectedAccess.role_name || null,
      roleName: expectedAccess.role_name || null,
      roleCode: expectedAccess.role_code || null,
      username: expectedAccess.username || null,
      corporateEmail: expectedAccess.corporate_email || null
    });

    // Verify camelCase response keys are returned and snake_case is avoided
    expect(res.body.data.source_worker_id).toBeUndefined();
    expect(res.body.data.source_user_id).toBeUndefined();
    expect(res.body.data.profile_status).toBeUndefined();
    expect(res.body.data.personal_data).toBeUndefined();
    expect(res.body.data.labor_data).toBeUndefined();
    expect(res.body.data.missing_fields).toBeUndefined();
  });

  test('2. Valid userId with worker', async () => {
    const res = await request(app)
      .get(`/api/workers/onboarding-prefill?userId=${validUserIdWithWorker}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.sourceUserId).toEqual(validUserIdWithWorker);
    expect(res.body.data.sourceWorkerId).toEqual(validWorkerId);
    expect(res.body.data.profileStatus).toBeDefined();
  });

  test('3. Valid userId without worker', async () => {
    const res = await request(app)
      .get(`/api/workers/onboarding-prefill?userId=${validUserIdWithoutWorker}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.sourceUserId).toEqual(validUserIdWithoutWorker);
    expect(res.body.data.sourceWorkerId).toBeNull();
    expect(res.body.data.profileStatus).toEqual('incomplete');
    expect(res.body.data.accessData).toHaveProperty('roleId');
    expect(res.body.data.accessData).toHaveProperty('role');
    expect(res.body.data.accessData).toHaveProperty('roleName');
    expect(res.body.data.accessData).toHaveProperty('roleCode');
    expect(res.body.data.accessData).toHaveProperty('username');
    expect(res.body.data.accessData).toHaveProperty('corporateEmail');
    expect(res.body.data.missingFields).toContain('laborData.companyId');
    expect(res.body.data.missingFields).toContain('personalData.dni');
  });

  test('4. Invalid workerId', async () => {
    const res = await request(app)
      .get('/api/workers/onboarding-prefill?workerId=PENDIENTE-87416')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toEqual(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toEqual('INVALID_WORKER_ID');
    expect(res.body.message).toEqual('workerId inválido. Debe ser un UUID válido.');
  });

  test('5. Invalid userId', async () => {
    const res = await request(app)
      .get('/api/workers/onboarding-prefill?userId=PENDIENTE-87416')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toEqual(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toEqual('INVALID_USER_ID');
    expect(res.body.message).toEqual('userId inválido. Debe ser un UUID válido.');
  });

  test('6. Missing parameters', async () => {
    const res = await request(app)
      .get('/api/workers/onboarding-prefill')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toEqual(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toEqual('MISSING_IDENTIFIER');
    expect(res.body.message).toEqual('Debe enviar workerId o userId para precargar el formulario.');
  });

  test('7. Worker from another tenant', async () => {
    const res = await request(app)
      .get(`/api/workers/onboarding-prefill?workerId=${workerIdFromOtherTenant}`)
      .set('Authorization', `Bearer ${adminToken}`);

    // Expecting 404 because it is scoped to current company/tenant
    expect([403, 404]).toContain(res.statusCode);
    expect(res.body.success).toBe(false);
  });
});
