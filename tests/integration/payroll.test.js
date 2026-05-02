const request = require('supertest');
const app = require('../../src/app');
const { query } = require('../../src/config/database');

describe('Payroll API Tests', () => {

  let adminToken = '';
  let workerToken = '';

  beforeAll(async () => {
    const adminRes = await request(app).post('/auth/login').send({ email: 'admin@demo.com', password: 'Demo123!' });
    adminToken = adminRes.body.data.accessToken;

    const workerRes = await request(app).post('/auth/login').send({ email: 'trabajador@demo.com', password: 'Demo123!' });
    workerToken = workerRes.body.data.accessToken;
  });

  afterAll(async () => {
    await query("DELETE FROM payroll_periods WHERE name = 'Periodo Test'");
  });

  test('POST /payroll/periods crea periodo correctamente', async () => {
    const res = await request(app)
      .post('/payroll/periods')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Periodo Test',
        year: 2026,
        month: 6,
        start_date: '2026-06-01',
        end_date: '2026-06-30'
      });
      
    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('draft');
  });

  test('GET /payroll/periods devuelve periodos', async () => {
    const res = await request(app)
      .get('/payroll/periods')
      .set('Authorization', `Bearer ${adminToken}`);
      
    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('GET /payroll/periods denegado a trabajadores', async () => {
    const res = await request(app)
      .get('/payroll/periods')
      .set('Authorization', `Bearer ${workerToken}`);
      
    expect(res.statusCode).toEqual(403);
  });

});
