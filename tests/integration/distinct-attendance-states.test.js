const {
  normalizeRequestType,
  serializeBlock,
  listApprovedAttendanceBlocks,
  expandApprovedAttendanceBlocks,
  getApprovedAttendanceDayCounts,
  assertAttendanceNotBlocked
} = require('../../src/shared/services/attendance-day-status.service');

describe('Estados diarios distintos de una falta', () => {
  test.each([
    ['VAC', 'Vacaciones', 'VACATION'],
    ['DESCANSO_MEDICO', 'Descanso médico', 'MEDICAL_LEAVE'],
    ['REQ_aad6e9', 'DESCANSO_MEDICO', 'MEDICAL_LEAVE'],
    ['REQ_medico', 'Descanso médico', 'MEDICAL_LEAVE'],
    ['PERMISO_PERSONAL', 'Permiso personal', 'UNPAID_LEAVE']
  ])('normaliza %s sin convertirlo en ABSENT', (code, name, expected) => {
    expect(normalizeRequestType(code, name)).toBe(expected);
    expect(normalizeRequestType(code, name)).not.toBe('ABSENT');
  });

  test('expande rangos y mantiene estados separados', () => {
    const days = expandApprovedAttendanceBlocks([
      {
        requestType: 'VACATION',
        attendanceStatus: 'vacation',
        priority: 1,
        startDate: '2026-07-01',
        endDate: '2026-07-03'
      },
      {
        requestType: 'MEDICAL_LEAVE',
        attendanceStatus: 'medical_leave',
        priority: 2,
        startDate: '2026-07-03',
        endDate: '2026-07-04'
      }
    ], '2026-07-01', '2026-07-04');

    expect(days).toHaveLength(4);
    expect(days.find((day) => day.date === '2026-07-03').attendanceStatus).toBe('vacation');
    expect(days.find((day) => day.date === '2026-07-04').attendanceStatus).toBe('medical_leave');
    expect(days.some((day) => day.attendanceStatus === 'absent')).toBe(false);
  });

  test('marca permiso personal como no remunerado y descanso medico como remunerado', () => {
    const unpaid = serializeBlock({
      id: '33333333-3333-4333-8333-333333333333',
      start_date: '2026-07-04',
      end_date: '2026-07-04',
      type_code: 'UNPAID_LEAVE',
      type_name: 'Permiso personal',
      is_paid: true,
      affects_payroll: true
    });
    const medical = serializeBlock({
      id: '22222222-2222-4222-8222-222222222222',
      start_date: '2026-07-03',
      end_date: '2026-07-03',
      type_code: 'MEDICAL_LEAVE',
      type_name: 'Descanso médico',
      is_paid: true,
      affects_payroll: true
    });

    expect(unpaid).toMatchObject({
      requestType: 'UNPAID_LEAVE',
      attendanceStatus: 'unpaid_leave',
      isPaid: false,
      perceivesPay: false,
      paymentStatus: 'unpaid',
      affectsPayroll: true
    });
    expect(medical).toMatchObject({
      requestType: 'MEDICAL_LEAVE',
      attendanceStatus: 'medical_leave',
      isPaid: true,
      perceivesPay: true,
      paymentStatus: 'paid',
      affectsPayroll: true
    });
  });

  test('cuenta vacaciones, descanso médico y permiso sin goce por separado', async () => {
    const db = {
      query: jest.fn().mockResolvedValue({
        rows: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            start_date: '2026-07-01',
            end_date: '2026-07-02',
            type_code: 'VACATION',
            type_name: 'Vacaciones'
          },
          {
            id: '22222222-2222-4222-8222-222222222222',
            start_date: '2026-07-03',
            end_date: '2026-07-03',
            type_code: 'MEDICAL_LEAVE',
            type_name: 'Descanso médico'
          },
          {
            id: '33333333-3333-4333-8333-333333333333',
            start_date: '2026-07-04',
            end_date: '2026-07-04',
            type_code: 'UNPAID_LEAVE',
            type_name: 'Permiso personal'
          }
        ]
      })
    };

    const counts = await getApprovedAttendanceDayCounts(
      'worker-id',
      'company-id',
      '2026-07-01',
      '2026-07-04',
      db
    );

    expect(counts).toEqual({ VACATION: 2, MEDICAL_LEAVE: 1, UNPAID_LEAVE: 1 });
    expect(counts).not.toHaveProperty('ABSENT');
  });

  test('bloquea check-in con un código específico y no con una falta genérica', async () => {
    const db = {
      query: jest.fn().mockResolvedValue({
        rows: [{
          id: '11111111-1111-4111-8111-111111111111',
          start_date: '2026-07-01',
          end_date: '2026-07-02',
          type_code: 'VACATION',
          type_name: 'Vacaciones'
        }]
      })
    };

    await expect(assertAttendanceNotBlocked(
      'worker-id',
      'company-id',
      '2026-07-01',
      db
    )).rejects.toMatchObject({
      statusCode: 403,
      errorCode: 'ATTENDANCE_BLOCKED_BY_APPROVED_REQUEST',
      details: {
        requestType: 'VACATION',
        attendanceStatus: 'vacation'
      }
    });

    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test('ignora tipos no laborales en el resolvedor de asistencia', async () => {
    const db = {
      query: jest.fn().mockResolvedValue({
        rows: [{
          id: '44444444-4444-4444-8444-444444444444',
          start_date: '2026-07-01',
          end_date: '2026-07-01',
          type_code: 'OTHER',
          type_name: 'Otro'
        }]
      })
    };

    await expect(listApprovedAttendanceBlocks(
      'worker-id',
      'company-id',
      '2026-07-01',
      '2026-07-01',
      db
    )).resolves.toEqual([]);
  });
});
