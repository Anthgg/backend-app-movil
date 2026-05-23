const request = require('supertest');
const app = require('../../src/app');
const { loginAsAdmin, loginAsTrabajador } = require('../helpers/auth.helper');

describe('Attendance API Tests', () => {

  let adminToken = '';
  let workerToken = '';

  beforeAll(async () => {
    adminToken = await loginAsAdmin(app);
    workerToken = await loginAsTrabajador(app);
  }, 30000);

  test('POST /attendance/check-in deniega si dispositivo no está autorizado', async () => {
    const res = await request(app)
      .post('/attendance/check-in')
      .set('Authorization', `Bearer ${workerToken}`)
      .send({
        latitude: -12.046374,
        longitude: -77.042793,
        gps_accuracy: 10,
        device_id: 'fake-device-not-registered',
        is_mock_location: false,
        project_id: '123e4567-e89b-12d3-a456-426614174000'
      });

    // Debe denegar porque el device_id no está registrado
    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error_code || res.body.message).toBe('DEVICE_NOT_REGISTERED');
  });

});
