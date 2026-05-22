const request = require('supertest');
const app = require('../../src/app');
const { query } = require('../../src/config/database');

describe('Dashboard API Tests', () => {
  let adminToken = '';
  let workerToken = '';
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const EMPTY_UUID = '99999999-9999-4999-9999-999999999999';

  const expectUbigeoCatalog = (res, message) => {
    expect(res.statusCode).toEqual(200);
    expect(res.body).toEqual({
      success: true,
      message,
      data: expect.any(Array)
    });

    for (const item of res.body.data) {
      expect(item).toEqual({
        id: expect.stringMatching(UUID_REGEX),
        name: expect.any(String)
      });
      expect(item.name.trim()).not.toBe('');
    }
  };

  const loginWithFallback = async (candidates) => {
    for (const candidate of candidates) {
      const res = await request(app).post('/auth/login').send(candidate);
      if (res.statusCode === 200 && res.body?.data?.accessToken) {
        return res.body.data.accessToken;
      }
    }

    throw new Error(`No se pudo autenticar con ningun usuario demo: ${candidates.map((item) => item.email).join(', ')}`);
  };

  beforeAll(async () => {
    adminToken = await loginWithFallback([
      { email: 'admin@demo.com', password: 'Demo123!' },
      { email: 'admin.qa@demo.com', password: 'AdminDemo2026!' }
    ]);

    workerToken = await loginWithFallback([
      { email: 'trabajador@demo.com', password: 'Demo123!' },
      { email: 'trabajador@demo.com', password: 'Demo1234!' },
      { email: 'trabajador@fabryor.com', password: 'Fabryor123!' }
    ]);
  }, 30000);

  test('GET /dashboard/summary responde correctamente para ADMIN', async () => {
    const res = await request(app)
      .get('/dashboard/summary')
      .set('Authorization', `Bearer ${adminToken}`);
      
    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('activeWorkers');
    expect(res.body.data).toHaveProperty('activeUsers');
  });

  test('GET /dashboard/summary respeta permisos del trabajador', async () => {
    const res = await request(app)
      .get('/dashboard/summary')
      .set('Authorization', `Bearer ${workerToken}`);

    expect([200, 403]).toContain(res.statusCode);

    if (res.statusCode === 200) {
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('activeWorkers');
    } else {
      expect(res.body.success).toBe(false);
    }
  });

  test('GET /dashboard/birthdays responde colecciones para ADMIN', async () => {
    const res = await request(app)
      .get('/dashboard/birthdays')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('today');
    expect(res.body.data).toHaveProperty('upcoming');
    expect(Array.isArray(res.body.data.today)).toBe(true);
    expect(Array.isArray(res.body.data.upcoming)).toBe(true);
  });

  test('GET /dashboard/alerts responde conteos y alertas para ADMIN', async () => {
    const res = await request(app)
      .get('/dashboard/alerts')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('counts');
    expect(res.body.data).toHaveProperty('alerts');
    expect(Array.isArray(res.body.data.alerts)).toBe(true);
  });

  test('GET /api/mobile/home/summary incluye birthdayGreeting', async () => {
    const res = await request(app)
      .get('/api/mobile/home/summary')
      .set('Authorization', `Bearer ${workerToken}`);

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('birthdayGreeting');
    expect(res.body.data.birthdayGreeting).toHaveProperty('show');
    expect(res.body.data.birthdayGreeting).toHaveProperty('message');
  });

  test('GET /api/ubigeo/departments retorna el catalogo completo', async () => {
    const cascadeRes = await query(
      `SELECT d.id AS department_id, p.id AS province_id
       FROM departments d
       JOIN provinces p
         ON p.department_id = d.id
        AND p.deleted_at IS NULL
        AND p.status = true
       JOIN districts di
         ON di.province_id = p.id
        AND di.deleted_at IS NULL
        AND di.status = true
       WHERE d.deleted_at IS NULL
         AND d.status = true
       ORDER BY d.name ASC, p.name ASC, di.name ASC
       LIMIT 1`
    );
    const departmentId = cascadeRes.rows[0]?.department_id;
    const provinceId = cascadeRes.rows[0]?.province_id;

    expect(departmentId).toMatch(UUID_REGEX);
    expect(provinceId).toMatch(UUID_REGEX);

    const departments = await request(app)
      .get('/api/ubigeo/departments')
      .set('Authorization', `Bearer ${adminToken}`);
    const provinces = await request(app)
      .get(`/api/ubigeo/provinces/${departmentId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const districts = await request(app)
      .get(`/api/ubigeo/districts/${provinceId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expectUbigeoCatalog(departments, 'Departamentos obtenidos correctamente');
    expectUbigeoCatalog(provinces, 'Provincias obtenidas correctamente');
    expectUbigeoCatalog(districts, 'Distritos obtenidos correctamente');
    expect(departments.body.data).toHaveLength(25);
    expect(provinces.body.data.length).toBeGreaterThan(0);
    expect(districts.body.data.length).toBeGreaterThan(0);
  });

  test('GET /api/ubigeo mantiene array vacio y valida IDs de cascada', async () => {
    const [emptyProvinces, emptyDistricts, invalidProvinces, invalidDistricts] = await Promise.all([
      request(app)
        .get(`/api/ubigeo/provinces/${EMPTY_UUID}`)
        .set('Authorization', `Bearer ${adminToken}`),
      request(app)
        .get(`/api/ubigeo/districts/${EMPTY_UUID}`)
        .set('Authorization', `Bearer ${adminToken}`),
      request(app)
        .get('/api/ubigeo/provinces/no-es-uuid')
        .set('Authorization', `Bearer ${adminToken}`),
      request(app)
        .get('/api/ubigeo/districts/no-es-uuid')
        .set('Authorization', `Bearer ${adminToken}`)
    ]);

    expectUbigeoCatalog(emptyProvinces, 'Sin resultados');
    expect(emptyProvinces.body.data).toEqual([]);
    expectUbigeoCatalog(emptyDistricts, 'Sin resultados');
    expect(emptyDistricts.body.data).toEqual([]);

    expect(invalidProvinces.statusCode).toEqual(422);
    expect(invalidProvinces.body.success).toBe(false);
    expect(invalidProvinces.body.errorCode).toBe('VALIDATION_ERROR');
    expect(invalidProvinces.body.errors).toContainEqual(expect.objectContaining({ field: 'departmentId' }));
    expect(invalidDistricts.statusCode).toEqual(422);
    expect(invalidDistricts.body.success).toBe(false);
    expect(invalidDistricts.body.errorCode).toBe('VALIDATION_ERROR');
    expect(invalidDistricts.body.errors).toContainEqual(expect.objectContaining({ field: 'provinceId' }));
  });

});
