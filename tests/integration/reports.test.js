const request = require('supertest');
const app = require('../../src/app');
const { loginAsAdmin, loginAsTrabajador } = require('../helpers/auth.helper');

describe('Reports API Tests', () => {

  let adminToken = '';
  let workerToken = '';

  beforeAll(async () => {
    adminToken = await loginAsAdmin(app);
    workerToken = await loginAsTrabajador(app);
  }, 30000);

  test('GET /reports/attendance devuelve JSON', async () => {
    const res = await request(app)
      .get('/reports/attendance')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('GET /reports/monthly-summary/export/excel devuelve buffer de Excel', async () => {
    const res = await request(app)
      .get('/reports/monthly-summary/export/excel')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toEqual(200);
    expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  test('GET /reports/attendance/export/pdf devuelve buffer de PDF', async () => {
    const res = await request(app)
      .get('/reports/attendance/export/pdf')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toEqual(200);
    expect(res.headers['content-type']).toBe('application/pdf');
  });

});
