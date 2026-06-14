jest.mock('../../src/config/database', () => ({
  query: jest.fn()
}));

const { query } = require('../../src/config/database');
const { validateAttendanceDeviceAndTenant } = require('../../src/shared/utils/validators');

const userRow = {
  user_active: true,
  user_status: 'active',
  company_id: '33333333-3333-4333-8333-333333333333',
  worker_id: '99999999-9999-4999-8999-999999999999',
  worker_active: true,
  employment_status: 'active',
  hire_date: '2026-01-01'
};

describe('Attendance validation contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('no bloquea asistencia cuando el deviceId no esta registrado', async () => {
    query
      .mockResolvedValueOnce({ rows: [userRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await validateAttendanceDeviceAndTenant(
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      'fake-device-not-registered',
      '2026-06-14'
    );

    expect(result).toMatchObject({
      workerId: userRow.worker_id,
      device: null,
      deviceContextRequired: false,
      isValid: true
    });
  });

  test('sigue bloqueando dispositivos explicitamente bloqueados', async () => {
    query
      .mockResolvedValueOnce({ rows: [userRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: '77777777-7777-4777-8777-777777777777',
          is_blocked: true,
          is_authorized: true
        }]
      });

    await expect(validateAttendanceDeviceAndTenant(
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      'blocked-device',
      '2026-06-14'
    )).rejects.toMatchObject({
      statusCode: 403,
      errorCode: 'DEVICE_BLOCKED'
    });
  });
});
