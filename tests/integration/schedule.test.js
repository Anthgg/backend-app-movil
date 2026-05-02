const request = require('supertest');
const app = require('../../src/app');

describe('Schedule API Tests', () => {

  let adminToken = '';

  beforeAll(async () => {
    const adminRes = await request(app).post('/auth/login').send({ email: 'admin@demo.com', password: 'Demo123!' });
    adminToken = adminRes.body.data.accessToken;
  });

  test('POST /schedule/shifts crea turno correctamente', async () => {
    const res = await request(app)
      .post('/schedule/shifts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Turno Mañana Testing',
        start_time: '08:00',
        end_time: '17:00',
        tolerance_minutes: 15,
        is_rotating: false,
        working_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
      });
      
    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Turno Mañana Testing');
  });

});
