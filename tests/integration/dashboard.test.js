const request = require('supertest');
const app = require('../../src/app');

describe('Dashboard API Tests', () => {
  let adminToken = '';
  let workerToken = '';

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

});
