const request = require('supertest');
const app = require('../../src/app');

describe('Dashboard API Tests', () => {

  let adminToken = '';
  let workerToken = '';

  beforeAll(async () => {
    // Login ADMIN
    const adminRes = await request(app).post('/auth/login').send({ email: 'admin@demo.com', password: 'Demo123!' });
    adminToken = adminRes.body.data.accessToken;

    // Login TRABAJADOR
    const workerRes = await request(app).post('/auth/login').send({ email: 'trabajador@demo.com', password: 'Demo123!' });
    workerToken = workerRes.body.data.accessToken;
  });

  test('GET /dashboard/summary responde correctamente para ADMIN', async () => {
    const res = await request(app)
      .get('/dashboard/summary')
      .set('Authorization', `Bearer ${adminToken}`);
      
    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('activeWorkers');
    expect(res.body.data).toHaveProperty('activeUsers');
  });

  test('GET /dashboard/summary bloqueado para TRABAJADOR', async () => {
    const res = await request(app)
      .get('/dashboard/summary')
      .set('Authorization', `Bearer ${workerToken}`);
      
    expect(res.statusCode).toEqual(403);
    expect(res.body.success).toBe(false);
  });

});
