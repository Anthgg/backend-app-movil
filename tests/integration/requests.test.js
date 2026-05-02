const request = require('supertest');
const app = require('../../src/app');
const { query } = require('../../src/config/database');

describe('Requests API Tests', () => {

  let adminToken = '';
  let workerToken = '';
  let requestTypeId = '';

  beforeAll(async () => {
    const adminRes = await request(app).post('/auth/login').send({ email: 'admin@demo.com', password: 'Demo123!' });
    adminToken = adminRes.body.data.accessToken;

    const workerRes = await request(app).post('/auth/login').send({ email: 'trabajador@demo.com', password: 'Demo123!' });
    workerToken = workerRes.body.data.accessToken;

    // Crear un tipo de solicitud genérico para probar
    const typeRes = await query(`
      INSERT INTO request_types (company_id, name, code, requires_approval)
      SELECT id, 'Permiso Personal', 'PERM_001', true FROM companies LIMIT 1
      RETURNING id
    `);
    requestTypeId = typeRes.rows[0].id;
  });

  afterAll(async () => {
    await query("DELETE FROM employee_requests WHERE reason = 'Cita medica test'");
  });

  test('POST /requests crea solicitud exitosamente', async () => {
    const res = await request(app)
      .post('/requests')
      .set('Authorization', `Bearer ${workerToken}`)
      .send({
        request_type_id: requestTypeId,
        start_date: '2026-06-01',
        end_date: '2026-06-01',
        start_time: '09:00',
        end_time: '12:00',
        reason: 'Cita medica test'
      });
      
    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('status', 'pending');
  });

  test('POST /requests falla por superposición de fechas', async () => {
    const res = await request(app)
      .post('/requests')
      .set('Authorization', `Bearer ${workerToken}`)
      .send({
        request_type_id: requestTypeId,
        start_date: '2026-06-01',
        end_date: '2026-06-01',
        reason: 'Otra Cita medica test superpuesta'
      });
      
    expect(res.statusCode).toEqual(500); // Or whatever error code you map Error throws to
    expect(res.body.success).toBe(false);
  });

});
