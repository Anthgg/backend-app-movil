const request = require('supertest');
const app = require('../../src/app');

describe('Schedule API Tests', () => {
  let adminToken = '';
  const expectedPolicy = {
    lateToleranceMinutes: 15,
    autoAbsenceEnabled: true,
    autoAbsenceAfterTime: '04:00',
    defaultBreakMinutes: 45,
    defaultBreakPaid: false,
    weeklyTargetMinutes: 2880,
    timezone: 'America/Lima',
    workingDays: [1, 2, 3, 4, 5, 6]
  };

  beforeAll(async () => {
    const adminRes = await request(app).post('/auth/login').send({ email: 'admin@demo.com', password: 'Demo123!' });
    adminToken = adminRes.body.data.accessToken;
  }, 10000);

  test('POST /schedule/shifts crea turno correctamente', async () => {
    const res = await request(app)
      .post('/schedule/shifts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Turno Manana Testing',
        start_time: '08:00',
        end_time: '17:00',
        tolerance_minutes: 15,
        is_rotating: false,
        working_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
      });

    expect(res.statusCode).toEqual(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Turno Manana Testing');
  });

  test('GET /api/schedule/policies devuelve contrato plano para frontend', async () => {
    const res = await request(app)
      .get('/api/schedule/policies')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toEqual(200);
    expect(res.body).toEqual(expect.objectContaining({
      lateToleranceMinutes: expect.any(Number),
      autoAbsenceEnabled: expect.any(Boolean),
      autoAbsenceAfterTime: expect.any(String),
      defaultBreakMinutes: expect.any(Number),
      defaultBreakPaid: expect.any(Boolean),
      weeklyTargetMinutes: expect.any(Number),
      timezone: expect.any(String),
      workingDays: expect.any(Array)
    }));
    expect(res.body).not.toHaveProperty('success');
    expect(res.body).not.toHaveProperty('data');
  });

  test('PUT /api/schedule/policies actualiza y responde el mismo contrato plano', async () => {
    const previous = await request(app)
      .get('/api/schedule/policies')
      .set('Authorization', `Bearer ${adminToken}`);

    try {
      const res = await request(app)
        .put('/api/schedule/policies')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(expectedPolicy);

      expect(res.statusCode).toEqual(200);
      expect(res.body).toEqual(expectedPolicy);
    } finally {
      if (previous.statusCode === 200) {
        await request(app)
          .put('/api/schedule/policies')
          .set('Authorization', `Bearer ${adminToken}`)
          .send(previous.body);
      }
    }
  });
});
