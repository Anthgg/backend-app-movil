const request = require('supertest');
const app = require('../../src/app');
const { query } = require('../../src/config/database');

describe('Jobs API Tests', () => {

  let adminToken = '';

  beforeAll(async () => {
    const adminRes = await request(app).post('/auth/login').send({ email: 'admin@demo.com', password: 'Demo123!' });
    adminToken = adminRes.body.data.accessToken;
  });

  afterAll(async () => {
    // Limpiar job runs test data
    await query("DELETE FROM job_runs WHERE job_name = 'generateDailyAbsencesJob'");
  });

  test('POST /jobs/attendance/generate-absences ejecuta correctamente', async () => {
    const res = await request(app)
      .post('/jobs/attendance/generate-absences')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        date: '2026-05-02'
      });
      
    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('absencesGenerated');
  });

  test('POST /jobs/attendance/close-incomplete ejecuta correctamente', async () => {
    const res = await request(app)
      .post('/jobs/attendance/close-incomplete')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        date: '2026-05-02'
      });
      
    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('closedCount');
  });

});
