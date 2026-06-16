jest.mock('../../src/config/database', () => ({
  query: jest.fn()
}));

const { query } = require('../../src/config/database');
const { validateAttendanceDeviceAndTenant } = require('../../src/shared/utils/validators');
const {
  buildAttendanceError,
  getLocalDateTimeParts,
  normalizeAttendanceInput,
  normalizeAttendanceTime,
  normalizeWorkLocationId,
  getAttendanceDayContext,
  assertScheduleAllowsAttendance,
  resolveAuthenticatedWorker
} = require('../../src/services/attendance-service/services/attendance-context.util');
const {
  serializeCurrentWorkLocation,
  serializeAttendanceRecord
} = require('../../src/services/attendance-service/services/mobile-attendance.service');
const attendanceRepository = require('../../src/services/attendance-service/repositories/attendance.repository');
const scheduleService = require('../../src/services/schedule-service/services/laborSchedule.service');
const { getActiveWorkLocationForWorker } = require('../../src/shared/services/worker-location-assignment.service');

const userRow = {
  user_active: true,
  user_status: 'active',
  company_id: '33333333-3333-4333-8333-333333333333',
  worker_id: '99999999-9999-4999-8999-999999999999',
  worker_active: true,
  employment_status: 'active',
  hire_date: '2026-01-01'
};

const mondayToSaturdayShift = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Turno 1 (Manana)',
  timezone: 'America/Lima',
  workingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
};

function getInsertValue(sql, params, columnName) {
  const columnList = String(sql).match(/INSERT INTO attendance_records \(([^)]+)\)/)?.[1] || '';
  const columns = columnList.split(', ').map((column) => column.trim());
  return params[columns.indexOf(columnName)];
}

function getUpdateValue(sql, params, columnName) {
  const setList = String(sql).match(/UPDATE attendance_records SET (.+) WHERE id = /)?.[1] || '';
  const columns = setList.split(', ').map((entry) => entry.split(' = ')[0].trim());
  return params[columns.indexOf(columnName)];
}

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

  test('construye errores de asistencia con aliases y details como objeto', () => {
    const built = buildAttendanceError({
      code: 'NON_WORKING_DAY',
      message: 'La fecha indicada no esta configurada como dia laboral para este turno.',
      status: 422,
      details: { date: '2026-06-14', day: 'sunday' }
    });

    expect(built.status).toBe(422);
    expect(built.body).toMatchObject({
      success: false,
      code: 'NON_WORKING_DAY',
      error_code: 'NON_WORKING_DAY',
      errorCode: 'NON_WORKING_DAY',
      details: { date: '2026-06-14', day: 'sunday' },
      error: {
        code: 'NON_WORKING_DAY',
        details: { date: '2026-06-14', day: 'sunday' }
      }
    });
    expect(Array.isArray(built.body.details)).toBe(false);
  });

  test('calcula fecha y hora local para columnas date y TIME', () => {
    const parts = getLocalDateTimeParts({
      now: new Date('2026-06-15T13:00:00.000+00:00'),
      timezone: 'America/Lima'
    });

    expect(parts).toEqual({
      date: '2026-06-15',
      time: '08:00:00',
      timezone: 'America/Lima'
    });
    expect(normalizeAttendanceTime('08:00', { timezone: 'America/Lima' })).toBe('08:00:00');
  });

  test('normaliza formatos flexibles de hora de asistencia', () => {
    const options = {
      fallbackDate: '2026-06-15',
      timezone: 'America/Lima',
      now: new Date('2026-06-15T13:00:00.000Z')
    };

    expect(normalizeAttendanceInput('23:05:12', options)).toMatchObject({
      date: '2026-06-15',
      time: '23:05:12',
      sourceFormat: 'HH:mm:ss'
    });
    expect(normalizeAttendanceInput('23:05', options)).toMatchObject({
      date: '2026-06-15',
      time: '23:05:00',
      sourceFormat: 'HH:mm'
    });
    expect(normalizeAttendanceInput('2026-06-15T23:05:12.000Z', {
      timezone: 'America/Lima'
    })).toMatchObject({
      date: '2026-06-15',
      time: '18:05:12',
      sourceFormat: 'datetime'
    });
    expect(normalizeAttendanceInput(new Date('2026-06-15T13:00:00.000Z'), {
      timezone: 'America/Lima'
    })).toMatchObject({
      date: '2026-06-15',
      time: '08:00:00',
      sourceFormat: 'date_object'
    });
    expect(normalizeAttendanceInput(null, options)).toMatchObject({
      date: '2026-06-15',
      time: '08:00:00',
      sourceFormat: 'server_now'
    });
  });

  test.each(['25:00:00', '23:99:00', 'abc', '2026-99-99'])(
    'rechaza hora de asistencia invalida: %s',
    (value) => {
      expect(() => normalizeAttendanceInput(value, {
        fallbackDate: '2026-06-15',
        timezone: 'America/Lima'
      })).toThrow(expect.objectContaining({
        statusCode: 400,
        errorCode: 'INVALID_ATTENDANCE_TIME',
        details: expect.objectContaining({
          acceptedFormats: expect.arrayContaining(['HH:mm:ss', 'HH:mm', 'ISO-8601 datetime'])
        })
      }));
    }
  );

  test('repository guarda check-in y check-out como HH:mm:ss para columnas TIME', async () => {
    const columns = [
      'id',
      'worker_id',
      'company_id',
      'date',
      'check_in_time',
      'check_out_time',
      'check_in_at',
      'check_out_at',
      'check_in_source_format',
      'check_out_source_format',
      'check_in_server_time',
      'check_out_server_time',
      'updated_at'
    ].map((column_name) => ({ column_name }));

    query
      .mockResolvedValueOnce({ rows: columns })
      .mockResolvedValueOnce({
        rows: [{
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          worker_id: userRow.worker_id,
          company_id: userRow.company_id,
          date: '2026-06-15',
          check_in_time: '08:00:00'
        }]
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          check_out_time: '17:00:00'
        }]
      });

    await attendanceRepository.createCheckIn({
      worker_id: userRow.worker_id,
      company_id: userRow.company_id,
      attendance_date: '2026-06-15',
      check_in_time: new Date('2026-06-15T13:00:00.000+00:00'),
      check_in_at: '2026-06-15T13:00:00.000Z',
      check_in_source_format: 'date_object',
      timezone: 'America/Lima'
    });
    await attendanceRepository.updateCheckOut('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
      date: '2026-06-15',
      check_out_time: new Date('2026-06-15T22:00:00.000+00:00'),
      check_out_at: '2026-06-15T22:00:00.000Z',
      check_out_source_format: 'date_object',
      timezone: 'America/Lima'
    });

    const insertCall = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO attendance_records'));
    const updateCall = query.mock.calls.find(([sql]) => String(sql).includes('UPDATE attendance_records SET'));

    expect(getInsertValue(insertCall[0], insertCall[1], 'check_in_time')).toBe('08:00:00');
    expect(getInsertValue(insertCall[0], insertCall[1], 'check_in_at')).toBe('2026-06-15T13:00:00.000Z');
    expect(getInsertValue(insertCall[0], insertCall[1], 'check_in_source_format')).toBe('date_object');
    expect(getUpdateValue(updateCall[0], updateCall[1], 'check_out_time')).toBe('17:00:00');
    expect(getUpdateValue(updateCall[0], updateCall[1], 'check_out_at')).toBe('2026-06-15T22:00:00.000Z');
    expect(getUpdateValue(updateCall[0], updateCall[1], 'check_out_source_format')).toBe('date_object');
  });

  test('repository rechaza horas invalidas antes de insertar asistencia', async () => {
    await expect(attendanceRepository.createCheckIn({
      worker_id: userRow.worker_id,
      company_id: userRow.company_id,
      attendance_date: '2026-06-15',
      check_in_time: 'hora-invalida',
      timezone: 'America/Lima'
    })).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'INVALID_ATTENDANCE_TIME',
      details: expect.objectContaining({
        expectedFormat: 'HH:mm:ss',
        acceptedFormats: expect.arrayContaining(['HH:mm:ss', 'HH:mm', 'ISO-8601 datetime'])
      })
    });
  });

  test('calcula metricas y serializa /today con valores TIME', () => {
    const schedule = {
      date: '2026-06-15',
      shift: {
        id: mondayToSaturdayShift.id,
        name: mondayToSaturdayShift.name,
        startTime: '08:00',
        endTime: '17:00',
        timezone: 'America/Lima',
        toleranceMinutes: 15,
        workingDays: [1, 2, 3, 4, 5, 6]
      },
      policy: { timezone: 'America/Lima' }
    };

    const metrics = scheduleService.calculateAttendanceMetrics({
      schedule,
      checkInTime: '08:16:00',
      status: 'present'
    });
    const serialized = serializeAttendanceRecord({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      date: '2026-06-15',
      check_in_time: '08:00:00'
    }, {
      todayDate: '2026-06-15',
      shift: schedule.shift
    });

    expect(metrics).toMatchObject({
      status: 'late',
      lateMinutes: 16
    });
    expect(serialized).toMatchObject({
      status: 'checked_in',
      checkIn: '08:00:00',
      check_in: '08:00:00',
      arrivalStatus: 'on_time'
    });
  });

  test('check-in domingo con turno lunes a sabado devuelve NON_WORKING_DAY con details utiles', () => {
    const schedule = {
      date: '2026-06-14',
      shift: mondayToSaturdayShift,
      policy: { timezone: 'America/Lima', workingDays: mondayToSaturdayShift.workingDays }
    };

    expect(() => assertScheduleAllowsAttendance(schedule, '2026-06-14')).toThrow(expect.objectContaining({
      statusCode: 422,
      errorCode: 'NON_WORKING_DAY',
      details: expect.objectContaining({
        date: '2026-06-14',
        day: 'sunday',
        timezone: 'America/Lima',
        workingDays: mondayToSaturdayShift.workingDays,
        shiftId: mondayToSaturdayShift.id,
        shiftName: mondayToSaturdayShift.name
      })
    }));
  });

  test('check-in sabado con turno lunes a sabado continua validacion normal', () => {
    const schedule = {
      date: '2026-06-13',
      shift: mondayToSaturdayShift,
      policy: { timezone: 'America/Lima', workingDays: mondayToSaturdayShift.workingDays }
    };

    const context = assertScheduleAllowsAttendance(schedule, '2026-06-13');

    expect(context).toMatchObject({
      date: '2026-06-13',
      day: 'saturday',
      timezone: 'America/Lima',
      isWorkingDay: true
    });
  });

  test('calcula el dia laboral usando timezone del turno', () => {
    const context = getAttendanceDayContext({
      date: '2026-06-14',
      shift: mondayToSaturdayShift,
      policy: { timezone: 'UTC', workingDays: ['sunday'] }
    });

    expect(context.timezone).toBe('America/Lima');
    expect(context.day).toBe('sunday');
    expect(context.isWorkingDay).toBe(false);
  });

  test('acepta workingDays numericos en contexto de asistencia movil', () => {
    const context = getAttendanceDayContext({
      date: '2026-06-13',
      shift: {
        ...mondayToSaturdayShift,
        workingDays: [1, 2, 3, 4, 5, 6]
      }
    });

    expect(context).toMatchObject({
      day: 'saturday',
      dayOfWeek: 6,
      workingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
      workingDaysNumbers: [1, 2, 3, 4, 5, 6],
      isWorkingDay: true
    });
  });

  test('normaliza workLocationId desde body, query y nombres legacy', () => {
    const id = '1ae7917b-6cf2-4909-a413-904ed5f5cdd1';

    expect(normalizeWorkLocationId({ body: { workLocationId: id } })).toBe(id);
    expect(normalizeWorkLocationId({ body: { work_location_id: id } })).toBe(id);
    expect(normalizeWorkLocationId({ body: {}, query: { workLocationId: id } })).toBe(id);
    expect(normalizeWorkLocationId({ body: {}, query: { work_location_id: id } })).toBe(id);

    expect(() => normalizeWorkLocationId({ body: { workLocationId: 'obra-invalida' } })).toThrow(expect.objectContaining({
      statusCode: 400,
      errorCode: 'INVALID_WORK_LOCATION_ID',
      details: { workLocationId: 'obra-invalida' }
    }));
  });

  test('serializa ubicacion temporal con aliases esperados por Flutter', () => {
    const serialized = serializeCurrentWorkLocation({
      workerId: userRow.worker_id,
      source: 'temporary_assignment',
      work_location: {
        id: '1ae7917b-6cf2-4909-a413-904ed5f5cdd1',
        name: 'Obra priueba',
        address: 'Av. Obra 123',
        latitude: '-12.1',
        longitude: '-77.1',
        allowed_radius_meters: 120
      },
      assignment: {
        id: '88888888-8888-4888-8888-888888888888',
        assignment_type: 'temporary'
      }
    });

    expect(serialized).toMatchObject({
      source: 'temporary_assignment',
      workLocationId: '1ae7917b-6cf2-4909-a413-904ed5f5cdd1',
      work_location_id: '1ae7917b-6cf2-4909-a413-904ed5f5cdd1',
      workLocationName: 'Obra priueba',
      work_location_name: 'Obra priueba',
      isTemporary: true,
      is_temporary: true
    });
  });

  test('prioriza ubicacion temporal activa al resolver obra del trabajador', async () => {
    query
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          id: userRow.worker_id,
          company_id: userRow.company_id,
          user_id: '22222222-2222-4222-8222-222222222222',
          work_location_id: null,
          is_active: true,
          employment_status: 'active'
        }]
      })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          assignment_id: '88888888-8888-4888-8888-888888888888',
          assignment_type: 'temporary',
          start_date: '2026-06-01',
          end_date: '2026-06-30',
          reason: 'refuerzo',
          auto_return: false,
          work_location_id: '1ae7917b-6cf2-4909-a413-904ed5f5cdd1',
          name: 'Obra priueba',
          address: 'Av. Obra 123',
          latitude: -12.1,
          longitude: -77.1,
          allowed_radius_meters: 100
        }]
      });

    const activeLocation = await getActiveWorkLocationForWorker(userRow.worker_id, userRow.company_id, '2026-06-14');

    expect(activeLocation).toMatchObject({
      source: 'temporary_assignment',
      work_location: {
        id: '1ae7917b-6cf2-4909-a413-904ed5f5cdd1',
        name: 'Obra priueba'
      }
    });
  });

  test('detecta worker mismatch contra empresa autenticada', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        user_id: '22222222-2222-4222-8222-222222222222',
        user_company_id: '44444444-4444-4444-8444-444444444444',
        user_active: true,
        user_status: 'active',
        worker_id: userRow.worker_id,
        worker_company_id: '44444444-4444-4444-8444-444444444444',
        worker_active: true,
        employment_status: 'active',
        base_work_location_id: null,
        crew_id: null
      }]
    });

    await expect(resolveAuthenticatedWorker({
      user: { id: '22222222-2222-4222-8222-222222222222' },
      tenantId: userRow.company_id
    })).rejects.toMatchObject({
      statusCode: 403,
      errorCode: 'WORKER_COMPANY_MISMATCH',
      details: expect.objectContaining({
        companyId: userRow.company_id
      })
    });
  });

  test('detecta worker inactivo con codigo WORKER_NOT_ACTIVE', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        user_id: '22222222-2222-4222-8222-222222222222',
        user_company_id: userRow.company_id,
        user_active: true,
        user_status: 'active',
        worker_id: userRow.worker_id,
        worker_company_id: userRow.company_id,
        worker_active: false,
        employment_status: 'terminated',
        base_work_location_id: null,
        crew_id: null
      }]
    });

    await expect(resolveAuthenticatedWorker({
      user: { id: '22222222-2222-4222-8222-222222222222' },
      tenantId: userRow.company_id
    })).rejects.toMatchObject({
      statusCode: 422,
      errorCode: 'WORKER_NOT_ACTIVE',
      details: expect.objectContaining({
        workerId: userRow.worker_id,
        workerStatus: 'terminated',
        isActive: false
      })
    });
  });
});
