const { query } = require('../../src/config/database');
const attendanceController = require('../../src/services/attendance-service/controllers/attendance.controller');

jest.mock('../../src/config/database', () => ({
  query: jest.fn()
}));

jest.mock('../../src/services/schedule-service/services/laborSchedule.service', () => ({
  resolveWorkerSchedule: jest.fn()
}));

jest.mock('../../src/shared/services/worker-location-assignment.service', () => ({
  getActiveWorkLocationForWorker: jest.fn().mockResolvedValue({
    work_location: { id: 'location-123' },
    source: 'permanent'
  })
}));

jest.mock('../../src/shared/services/attendance-day-status.service', () => ({
  getApprovedAttendanceBlock: jest.fn().mockResolvedValue(null),
  getApprovedAttendanceDays: jest.fn().mockResolvedValue([]),
  getApprovedAttendanceDayCounts: jest.fn().mockResolvedValue({
    VACATION: 0,
    MEDICAL_LEAVE: 0,
    UNPAID_LEAVE: 0
  })
}));

const scheduleService = require('../../src/services/schedule-service/services/laborSchedule.service');
const attendanceDayStatusService = require('../../src/shared/services/attendance-day-status.service');

describe('GET /api/mobile/attendance/today', () => {
  let req;
  let res;
  let next;

  const validUserId = '11111111-1111-4111-8111-111111111111';
  const validTenantId = '22222222-2222-4222-8222-222222222222';
  const validWorkerId = '33333333-3333-4333-8333-333333333333';

  beforeEach(() => {
    jest.clearAllMocks();
    attendanceDayStatusService.getApprovedAttendanceBlock.mockResolvedValue(null);
    req = {
      user: { id: validUserId },
      tenantId: validTenantId,
      query: { date: '2026-06-16' },
      originalUrl: '/api/mobile/attendance/today'
    };
    res = {
      json: jest.fn(),
      set: jest.fn(),
      status: jest.fn().mockReturnThis()
    };
    next = jest.fn();
  });

  test('Trabajador con dia laboral', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{
          user_id: validUserId,
          user_company_id: validTenantId,
          user_active: true,
          user_status: 'active',
          worker_id: validWorkerId,
          worker_company_id: validTenantId,
          worker_active: true,
          employment_status: 'active'
        }]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    scheduleService.resolveWorkerSchedule.mockResolvedValue({
      date: '2026-06-16',
      shift: {
        id: '44444444-4444-4444-8444-444444444444',
        name: 'Shift',
        startTime: '08:00',
        endTime: '17:00',
        timezone: 'America/Lima',
        workingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
      },
      policy: { timezone: 'America/Lima' }
    });

    await attendanceController.getTodayRecord(req, res, next);
    
    expect(res.json).toHaveBeenCalled();
    const responseBody = res.json.mock.calls[0][0];
    
    expect(responseBody.success).toBe(true);
    expect(responseBody.data).toHaveProperty('isWorkingDay');
    expect(typeof responseBody.data.isWorkingDay).toBe('boolean');
    expect(responseBody.data.isWorkingDay).toBe(true);
  });

  test('Trabajador con dia no laboral', async () => {
    query.mockReset();
    query
      .mockResolvedValueOnce({
        rows: [{
          user_id: validUserId,
          user_company_id: validTenantId,
          user_active: true,
          user_status: 'active',
          worker_id: validWorkerId,
          worker_company_id: validTenantId,
          worker_active: true,
          employment_status: 'active'
        }]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    scheduleService.resolveWorkerSchedule.mockResolvedValue({
      date: '2026-06-16', // June 16, 2026 is Tuesday
      shift: {
        id: '44444444-4444-4444-8444-444444444444',
        name: 'Shift',
        startTime: '08:00',
        endTime: '17:00',
        timezone: 'America/Lima',
        workingDays: ['sunday'] // Not today
      },
      policy: { timezone: 'America/Lima' }
    });

    await attendanceController.getTodayRecord(req, res, next);
    
    expect(res.json).toHaveBeenCalled();
    const responseBody = res.json.mock.calls[0][0];
    
    expect(responseBody.success).toBe(true);
    expect(responseBody.data).toHaveProperty('isWorkingDay');
    expect(typeof responseBody.data.isWorkingDay).toBe('boolean');
    expect(responseBody.data.isWorkingDay).toBe(false);
  });

  test('Calculo usa explicitamente America/Lima', async () => {
    query.mockReset();
    query
      .mockResolvedValueOnce({
        rows: [{
          user_id: validUserId,
          user_company_id: validTenantId,
          user_active: true,
          user_status: 'active',
          worker_id: validWorkerId,
          worker_company_id: validTenantId,
          worker_active: true,
          employment_status: 'active'
        }]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    // Assuming we test around midnight UTC where it's still previous day in Lima
    // We already passed `isWorkingDay` as property. Here we verify the behavior via the controller
    req.query.date = '2026-06-15T02:00:00Z'; // It's June 14 21:00 in Lima
    
    scheduleService.resolveWorkerSchedule.mockResolvedValue({
      date: '2026-06-14', // Expected resolved date in Lima
      shift: {
        id: '44444444-4444-4444-8444-444444444444',
        name: 'Shift',
        startTime: '08:00',
        endTime: '17:00',
        timezone: 'America/Lima',
        workingDays: ['sunday'] 
      },
      policy: { timezone: 'America/Lima' }
    });

    await attendanceController.getTodayRecord(req, res, next);
    
    expect(res.json).toHaveBeenCalled();
    const responseBody = res.json.mock.calls[0][0];
    
    expect(responseBody.success).toBe(true);
    expect(responseBody.data).toHaveProperty('isWorkingDay');
    expect(responseBody.data.timezone).toBe('America/Lima');
  });

  test('Campo obligatorio: falla si isWorkingDay no existe', () => {
    // This test ensures that the shape returned by serializeAttendanceRecord contains the key
    const { serializeAttendanceRecord } = require('../../src/services/attendance-service/services/mobile-attendance.service');
    const result = serializeAttendanceRecord(null, { shift: null });
    expect(result).toHaveProperty('isWorkingDay');
    expect(typeof result.isWorkingDay).toBe('boolean');
  });

  test('vacaciones aprobadas no se reportan como falta ni como día no programado', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{
          user_id: validUserId,
          user_company_id: validTenantId,
          user_active: true,
          user_status: 'active',
          worker_id: validWorkerId,
          worker_company_id: validTenantId,
          worker_active: true,
          employment_status: 'active'
        }]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    scheduleService.resolveWorkerSchedule.mockResolvedValue({
      date: '2026-06-16',
      shift: {
        id: '44444444-4444-4444-8444-444444444444',
        name: 'Shift',
        startTime: '08:00',
        endTime: '17:00',
        timezone: 'America/Lima',
        workingDays: ['tuesday']
      },
      policy: { timezone: 'America/Lima' }
    });
    attendanceDayStatusService.getApprovedAttendanceBlock.mockResolvedValue({
      requestId: '55555555-5555-4555-8555-555555555555',
      requestType: 'VACATION',
      attendanceStatus: 'vacation',
      displayStatus: 'Vacaciones',
      message: 'Estás de vacaciones',
      startDate: '2026-06-16',
      endDate: '2026-06-20'
    });

    await attendanceController.getTodayRecord(req, res, next);

    const data = res.json.mock.calls[0][0].data;
    expect(data).toMatchObject({
      status: 'vacation',
      attendanceStatus: 'vacation',
      isWorkingDay: true,
      scheduledWorkingDay: true,
      attendanceRequired: false,
      blockedByRequest: true,
      canCheckIn: false,
      isAbsence: false,
      absenceReason: null
    });
    expect(data.status).not.toBe('absent');
  });

  test('historial mensual expone tardanza, solicitudes aprobadas, feriado y descanso con etiquetas', async () => {
    query.mockReset();
    scheduleService.resolveWorkerSchedule.mockReset();
    req.query = { month: '6', year: '2026', limit: '100' };
    req.originalUrl = '/api/mobile/attendance/history';

    query
      .mockResolvedValueOnce({
        rows: [{
          user_id: validUserId,
          user_company_id: validTenantId,
          user_active: true,
          user_status: 'active',
          worker_id: validWorkerId,
          worker_company_id: validTenantId,
          worker_active: true,
          employment_status: 'active'
        }]
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          worker_id: validWorkerId,
          company_id: validTenantId,
          date: '2026-06-15',
          status: 'present',
          check_in_time: '08:30:00',
          check_out_time: '17:00:00',
          worked_hours: 8,
          effective_worked_minutes: 480,
          late_minutes: 30,
          overtime_minutes: 0,
          base_salary: 2400
        }]
      });

    attendanceDayStatusService.getApprovedAttendanceDays.mockResolvedValue([
      {
        date: '2026-06-17',
        requestId: '55555555-5555-4555-8555-555555555555',
        requestType: 'VACATION',
        attendanceStatus: 'vacation',
        displayStatus: 'Vacaciones',
        message: 'Estás de vacaciones',
        startDate: '2026-06-17',
        endDate: '2026-06-17'
      },
      {
        date: '2026-06-18',
        requestId: '66666666-6666-4666-8666-666666666666',
        requestType: 'MEDICAL_LEAVE',
        attendanceStatus: 'medical_leave',
        displayStatus: 'Descanso médico',
        message: 'Estás con descanso médico',
        startDate: '2026-06-18',
        endDate: '2026-06-18'
      }
    ]);

    scheduleService.resolveWorkerSchedule.mockImplementation((_workerId, _companyId, dateValue) => {
      const date = String(dateValue || '2026-06-15').slice(0, 10);
      const day = new Date(`${date}T12:00:00.000Z`).getUTCDay();
      const isHoliday = date === '2026-06-16';
      const isRestDay = day === 0;

      return Promise.resolve({
        date,
        isWorkingDay: !isHoliday && !isRestDay,
        isHoliday,
        holiday: isHoliday ? { id: 'holiday-id', name: 'Feriado QA' } : null,
        isRestDay,
        restDayType: isRestDay ? 'fijo' : null,
        shift: {
          id: '44444444-4444-4444-8444-444444444444',
          name: 'Shift',
          startTime: '08:00',
          endTime: '17:00',
          timezone: 'America/Lima',
          toleranceMinutes: 15,
          workingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
        },
        policy: { timezone: 'America/Lima' }
      });
    });

    await attendanceController.getHistory(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const records = res.json.mock.calls[0][0].data.records;
    const byDate = Object.fromEntries(records.map((record) => [record.date, record]));

    expect(byDate['2026-06-15']).toMatchObject({
      status: 'late',
      attendanceStatus: 'late',
      statusLabel: 'Tardanza',
      workflowStatus: 'checked_out',
      hasAttendanceRecord: true
    });
    expect(byDate['2026-06-16']).toMatchObject({
      status: 'holiday',
      attendanceStatus: 'holiday',
      statusLabel: 'Feriado',
      holidayName: 'Feriado QA',
      hasAttendanceRecord: false
    });
    expect(byDate['2026-06-17']).toMatchObject({
      status: 'vacation',
      attendanceStatus: 'vacation',
      statusLabel: 'Vacaciones',
      source: 'REQUEST'
    });
    expect(byDate['2026-06-18']).toMatchObject({
      status: 'medical_leave',
      attendanceStatus: 'medical_leave',
      statusLabel: 'Descanso médico',
      source: 'REQUEST'
    });
    expect(byDate['2026-06-21']).toMatchObject({
      status: 'rest_day',
      attendanceStatus: 'rest_day',
      statusLabel: 'Es tu descanso',
      hasAttendanceRecord: false
    });
  });
});
